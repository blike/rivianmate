import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type {
  ChargingSessionDto,
  DriveDto,
  TripActivityKind,
  TripActivityRef,
  TripAssignmentDto,
  TripCandidatesDto,
  TripDetailDto,
  TripDto,
  TripRouteDto,
  TripSummaryDto,
} from '../api-types.js';
import type { AppContext } from '../context.js';
import {
  chargingSessions,
  drives,
  locationPoints,
  tripActivities,
  tripExclusions,
  trips,
  vehicles,
} from '../db/schema.js';
import { MIN_DRIVE_KM } from '../services/drive-metrics.js';
import { isTimeZone } from '../services/electrafi/parse.js';
import { rangeOf } from '../services/electrafi/plan.js';
import { tripProfiles } from '../services/trip-profile.js';
import { thinTrack, trackToleranceM } from '../services/simplify-track.js';
import { tripStats } from '../services/trip-stats.js';
import { isTeslaMateVehicle } from '../teslamate/ids.js';
import { placeContext, sessionDtos } from './charging.js';
import { driveDtos } from './history.js';
import { WINDOW_LIMIT } from './list-window.js';

const MAX_NAME = 120;
const MAX_NOTES = 5000;
/** More than any trip holds; a request is added in one transaction. */
const MAX_ITEMS_PER_ADD = 1000;
/**
 * How long a vehicle's trips are taken as up to date after they last took in
 * what's finished. Reads come in bursts (a page asks for trips, a trip and its
 * route at once, and refreshes each minute), and each would read every trip's
 * days again. A change to any trip doesn't wait.
 */
const COLLECT_MS = 30_000;

const name = z.string().trim().min(1).max(MAX_NAME);
const notes = z.string().trim().max(MAX_NOTES).nullable();
const date = z.iso.date().nullable();

const timeZone = z.string().refine(isTimeZone, 'Unknown time zone').nullable();

const fields = z.object({
  name,
  notes: notes.optional(),
  startDate: date.optional(),
  endDate: date.optional(),
  timeZone: timeZone.optional(),
});
type TripFields = Omit<z.infer<typeof fields>, 'name'>;

const datesInOrder = (t: TripFields) => !t.startDate || !t.endDate || t.startDate <= t.endDate;
const DATE_ORDER = { error: 'The trip can’t end before it starts.', path: ['endDate'] };
/** A trip's days are days somewhere: dates need the zone they're in. */
const zoned = (t: TripFields) => t.startDate == null || t.timeZone != null;
const ZONE_NEEDED = { error: 'The trip’s dates need a time zone.', path: ['timeZone'] };

const createSchema = fields.refine(datesInOrder, DATE_ORDER).refine(zoned, ZONE_NEEDED);
/** Checked against the trip as it would be, once merged with what's stored. */
const patchSchema = fields.partial();

const activityKind = z.enum(['drive', 'charge']);
const activityId = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);

const activityRefs = z
  .array(z.object({ kind: activityKind, id: activityId }))
  .max(MAX_ITEMS_PER_ADD);

const addSchema = z
  .object({
    items: activityRefs,
    /** Take items that are in another trip out of it; without this they're refused. */
    move: z.boolean().default(false),
    /** Ones to keep out, so the trip's dates don't take them in. */
    exclude: activityRefs.default([]),
  })
  .refine((b) => b.items.length + b.exclude.length > 0, 'Nothing to add.');

const removeParams = z.object({ kind: activityKind, activityId });

const candidatesSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  /** The trip being edited, to say what was taken out of it. */
  tripId: z.coerce.number().int().positive().optional(),
});

type TripRow = typeof trips.$inferSelect;

/** Rolls back an add that found activities in another trip. */
class AssignedElsewhere extends Error {
  constructor(readonly tripNames: string[]) {
    super('Assigned to another trip');
  }
}

export async function tripRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // TeslaMate says nothing when a drive ends, so trips take in what's finished
  // when they're read, at most once a while for each vehicle.
  const collectedAt = new Map<string, number>();
  const collect = async (vehicleId: string) => {
    const at = collectedAt.get(vehicleId);
    if (at != null && Date.now() - at < COLLECT_MS) return;
    collectedAt.set(vehicleId, Date.now());
    try {
      await collectOpenTrips(ctx, vehicleId);
    } catch (err) {
      collectedAt.delete(vehicleId);
      throw err;
    }
  };
  const changed = (vehicleId: string) => collectedAt.delete(vehicleId);

  app.get<{ Params: { id: string } }>(
    '/api/vehicles/:id/trips',
    async (request): Promise<TripSummaryDto[]> => {
      const vehicleId = request.params.id;
      await collect(vehicleId);
      const rows = await ctx.db.select().from(trips).where(eq(trips.vehicleId, vehicleId));
      const links = await ctx.db
        .select()
        .from(tripActivities)
        .where(eq(tripActivities.vehicleId, vehicleId));
      const { drives: allDrives, sessions } = await loadActivities(ctx, vehicleId, links);
      const defaultCurrency = (await placeContext(ctx)).settings.currency;
      const summaries = rows.map((row) => {
        const own = links.filter((l) => l.tripId === row.id);
        const driveIds = new Set(own.filter((l) => l.kind === 'drive').map((l) => l.activityId));
        const chargeIds = new Set(own.filter((l) => l.kind === 'charge').map((l) => l.activityId));
        return {
          ...toTripDto(row),
          stats: tripStats(
            allDrives.filter((d) => driveIds.has(d.id)),
            sessions.filter((s) => chargeIds.has(s.id)),
            defaultCurrency,
          ),
        };
      });
      // Newest journey first, by the dates it's shown with.
      const when = (t: TripSummaryDto) => t.startDate ?? t.stats.startedAt ?? t.createdAt;
      return summaries.sort((a, b) => when(b).localeCompare(when(a)));
    },
  );

  app.post<{ Params: { id: string } }>('/api/vehicles/:id/trips', async (request, reply) => {
    const body = createSchema.parse(request.body);
    const vehicleId = request.params.id;
    if (!(await vehicleExists(ctx, vehicleId))) {
      return reply.code(404).send({ error: 'Not found' });
    }
    const clash = await overlapping(ctx, vehicleId, null, body);
    if (clash) return reply.code(409).send({ error: overlapError(clash) });
    const [row] = await ctx.db
      .insert(trips)
      .values({
        vehicleId,
        name: body.name,
        notes: body.notes || null,
        startDate: body.startDate ?? null,
        endDate: body.endDate ?? null,
        timeZone: body.timeZone ?? null,
      })
      .returning();
    changed(vehicleId);
    return reply.code(201).send(toTripDto(row!));
  });

  app.get<{ Params: { id: string; tripId: string } }>(
    '/api/vehicles/:id/trips/:tripId',
    async (request, reply): Promise<TripDetailDto | void> => {
      const row = await findTrip(ctx, request.params.id, request.params.tripId);
      if (!row) return reply.code(404).send({ error: 'Not found' });
      await collect(row.vehicleId);
      const links = await ctx.db
        .select()
        .from(tripActivities)
        .where(eq(tripActivities.tripId, row.id));
      const { drives: tripDrives, sessions } = await loadActivities(ctx, row.vehicleId, links);
      return {
        ...toTripDto(row),
        stats: tripStats(tripDrives, sessions, (await placeContext(ctx)).settings.currency),
        drives: tripDrives,
        sessions,
        missing: links.length - tripDrives.length - sessions.length,
      };
    },
  );

  app.patch<{ Params: { id: string; tripId: string } }>(
    '/api/vehicles/:id/trips/:tripId',
    async (request, reply) => {
      const body = patchSchema.parse(request.body);
      const row = await findTrip(ctx, request.params.id, request.params.tripId);
      if (!row) return reply.code(404).send({ error: 'Not found' });
      const next = {
        name: body.name ?? row.name,
        notes: body.notes === undefined ? row.notes : body.notes || null,
        startDate: body.startDate === undefined ? row.startDate : body.startDate,
        endDate: body.endDate === undefined ? row.endDate : body.endDate,
        timeZone: body.timeZone === undefined ? row.timeZone : body.timeZone,
      };
      if (!datesInOrder(next)) return reply.code(400).send({ error: DATE_ORDER.error });
      if (!zoned(next)) return reply.code(400).send({ error: ZONE_NEEDED.error });
      const clash = await overlapping(ctx, row.vehicleId, row.id, next);
      if (clash) return reply.code(409).send({ error: overlapError(clash) });
      const [updated] = await ctx.db
        .update(trips)
        .set({ ...next, updatedAt: new Date() })
        .where(eq(trips.id, row.id))
        .returning();
      changed(row.vehicleId);
      return toTripDto(updated!);
    },
  );

  app.delete<{ Params: { id: string; tripId: string } }>(
    '/api/vehicles/:id/trips/:tripId',
    async (request, reply) => {
      const row = await findTrip(ctx, request.params.id, request.params.tripId);
      if (!row) return reply.code(404).send({ error: 'Not found' });
      // Only the grouping goes: its drives and charges stay as they were.
      await ctx.db.delete(trips).where(eq(trips.id, row.id));
      changed(row.vehicleId);
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { id: string; tripId: string } }>(
    '/api/vehicles/:id/trips/:tripId/activities',
    async (request, reply) => {
      changed(request.params.id);
      return addActivities(ctx, request.params, request.body, reply);
    },
  );

  app.delete<{ Params: { id: string; tripId: string; kind: string; activityId: string } }>(
    '/api/vehicles/:id/trips/:tripId/activities/:kind/:activityId',
    async (request, reply) => {
      const params = removeParams.parse(request.params);
      const row = await findTrip(ctx, request.params.id, request.params.tripId);
      if (!row) return reply.code(404).send({ error: 'Not found' });
      await ctx.db.transaction(async (tx) => {
        await tx
          .delete(tripActivities)
          .where(
            and(
              eq(tripActivities.tripId, row.id),
              eq(tripActivities.kind, params.kind),
              eq(tripActivities.activityId, params.activityId),
            ),
          );
        // Taken out stays out, should the trip's dates take it in now or later.
        await tx
          .insert(tripExclusions)
          .values({ tripId: row.id, kind: params.kind, activityId: params.activityId })
          .onConflictDoNothing();
      });
      await touch(ctx, row.id);
      changed(row.vehicleId);
      return reply.code(204).send();
    },
  );

  app.get<{ Params: { id: string; tripId: string } }>(
    '/api/vehicles/:id/trips/:tripId/route',
    async (request, reply): Promise<TripRouteDto[] | void> => {
      const row = await findTrip(ctx, request.params.id, request.params.tripId);
      if (!row) return reply.code(404).send({ error: 'Not found' });
      await collect(row.vehicleId);
      const links = await ctx.db
        .select({ activityId: tripActivities.activityId })
        .from(tripActivities)
        .where(and(eq(tripActivities.tripId, row.id), eq(tripActivities.kind, 'drive')));
      return tripRoute(
        ctx,
        row.vehicleId,
        links.map((l) => l.activityId),
      );
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/vehicles/:id/trip-assignments',
    async (request): Promise<TripAssignmentDto[]> => {
      await collect(request.params.id);
      return assignments(ctx, request.params.id);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/vehicles/:id/trip-candidates',
    async (request): Promise<TripCandidatesDto> => {
      const { from, to, tripId } = candidatesSchema.parse(request.query);
      const vehicleId = request.params.id;
      await collect(vehicleId);
      const excluded = tripId != null ? await exclusionsOf(ctx, vehicleId, tripId) : [];
      const finished = <T extends { endedAt: string | null }>(items: T[]) =>
        items.filter((i) => i.endedAt != null);
      if (isTeslaMateVehicle(vehicleId)) {
        const places = await placeContext(ctx);
        const window = { from, to, limit: WINDOW_LIMIT };
        return {
          drives: finished(await ctx.teslamate.drives(vehicleId, places, window)),
          sessions: finished(await ctx.teslamate.chargingSessions(vehicleId, places, window)),
          assignments: await assignments(ctx, vehicleId),
          excluded,
        };
      }
      const driveRows = await ctx.db
        .select()
        .from(drives)
        .where(drivesBetween(vehicleId, from, to))
        .orderBy(desc(drives.startedAt))
        .limit(WINDOW_LIMIT);
      const sessionRows = await ctx.db
        .select()
        .from(chargingSessions)
        .where(sessionsBetween(vehicleId, from, to))
        .orderBy(desc(chargingSessions.startedAt))
        .limit(WINDOW_LIMIT);
      return {
        drives: await driveDtos(ctx, vehicleId, driveRows),
        sessions: await sessionDtos(ctx, vehicleId, sessionRows),
        assignments: await assignments(ctx, vehicleId),
        excluded,
      };
    },
  );
}

/** What was taken out of one of the vehicle's trips. */
async function exclusionsOf(
  ctx: AppContext,
  vehicleId: string,
  tripId: number,
): Promise<TripActivityRef[]> {
  return ctx.db
    .select({ kind: tripExclusions.kind, id: tripExclusions.activityId })
    .from(tripExclusions)
    .innerJoin(trips, eq(trips.id, tripExclusions.tripId))
    .where(and(eq(trips.id, tripId), eq(trips.vehicleId, vehicleId)));
}

async function addActivities(
  ctx: AppContext,
  params: { id: string; tripId: string },
  rawBody: unknown,
  reply: FastifyReply,
) {
  const body = addSchema.parse(rawBody);
  const row = await findTrip(ctx, params.id, params.tripId);
  if (!row) return reply.code(404).send({ error: 'Not found' });
  const vehicleId = row.vehicleId;
  const ids = (kind: TripActivityKind) => [
    ...new Set(body.items.filter((i) => i.kind === kind).map((i) => i.id)),
  ];
  const links = [
    ...ids('drive').map((activityId) => ({ kind: 'drive' as const, activityId })),
    ...ids('charge').map((activityId) => ({ kind: 'charge' as const, activityId })),
  ];

  // Only the vehicle's own records, and only finished ones: a charge under
  // way can still be discarded, and a drive's figures aren't settled.
  const found = links.length
    ? await loadActivities(ctx, vehicleId, links)
    : { drives: [], sessions: [] };
  const finished = [...found.drives, ...found.sessions].filter((a) => a.endedAt != null);
  if (finished.length !== links.length) {
    return reply
      .code(400)
      .send({ error: 'Only this vehicle’s finished drives and charges can be added.' });
  }

  const values = links.map((l) => ({ ...l, tripId: row.id, vehicleId }));
  const keptOut = body.exclude.map((e) => ({ tripId: row.id, kind: e.kind, activityId: e.id }));
  try {
    await ctx.db.transaction(async (tx) => {
      if (keptOut.length > 0) {
        // The builder sends all it keeps out, mostly kept out already; offering
        // those again would spend an id on each.
        const already = await tx
          .select({ kind: tripExclusions.kind, activityId: tripExclusions.activityId })
          .from(tripExclusions)
          .where(and(eq(tripExclusions.tripId, row.id), pairIn(tripExclusions, keptOut)));
        const had = new Set(already.map((e) => `${e.kind}:${e.activityId}`));
        const fresh = keptOut.filter((e) => !had.has(`${e.kind}:${e.activityId}`));
        if (fresh.length > 0) await tx.insert(tripExclusions).values(fresh).onConflictDoNothing();
        await tx
          .delete(tripActivities)
          .where(and(eq(tripActivities.tripId, row.id), pairIn(tripActivities, keptOut)));
      }
      if (values.length === 0) return;
      // Added by hand, so no longer kept out.
      await tx
        .delete(tripExclusions)
        .where(and(eq(tripExclusions.tripId, row.id), pairIn(tripExclusions, links)));
      if (body.move) {
        // A trip with dates mustn't take back what was moved out of it.
        const moving = await tx
          .select({
            tripId: tripActivities.tripId,
            kind: tripActivities.kind,
            activityId: tripActivities.activityId,
          })
          .from(tripActivities)
          .where(
            and(
              eq(tripActivities.vehicleId, vehicleId),
              sql`${tripActivities.tripId} <> ${row.id}`,
              pairIn(tripActivities, links),
            ),
          );
        if (moving.length > 0) {
          await tx.insert(tripExclusions).values(moving).onConflictDoNothing();
        }
      }
      const insert = tx.insert(tripActivities).values(values);
      await (body.move
        ? insert.onConflictDoUpdate({
            target: [tripActivities.vehicleId, tripActivities.kind, tripActivities.activityId],
            set: { tripId: row.id },
          })
        : insert.onConflictDoNothing());
      // The unique index settles any race: whatever isn't here now is elsewhere.
      const elsewhere = await tx
        .selectDistinct({
          name: trips.name,
          tripId: trips.id,
          kind: tripActivities.kind,
          id: tripActivities.activityId,
        })
        .from(tripActivities)
        .innerJoin(trips, eq(trips.id, tripActivities.tripId))
        .where(
          and(
            eq(tripActivities.vehicleId, vehicleId),
            sql`${tripActivities.tripId} <> ${row.id}`,
            pairIn(tripActivities, links),
          ),
        );
      if (elsewhere.length > 0) {
        throw new AssignedElsewhere([...new Set(elsewhere.map((e) => e.name))]);
      }
    });
    await touch(ctx, row.id);
  } catch (err) {
    if (!(err instanceof AssignedElsewhere)) throw err;
    return reply
      .code(409)
      .send({ error: `Already in ${err.tripNames.join(', ')}. Move it to add it here.` });
  }
  return reply.code(204).send();
}

const touch = (ctx: AppContext, tripId: number) =>
  ctx.db.update(trips).set({ updatedAt: new Date() }).where(eq(trips.id, tripId));

/** A table's rows whose (kind, activity id) is one of these. */
const pairIn = (
  table: typeof tripActivities | typeof tripExclusions,
  refs: readonly { kind: TripActivityKind; activityId: number }[],
) =>
  sql`(${table.kind}, ${table.activityId}) IN (${sql.join(
    refs.map((r) => sql`(${r.kind}, ${r.activityId}::bigint)`),
    sql`, `,
  )})`;

/**
 * Another of the vehicle's trips that shares a day with these dates: both
 * would claim what's driven on it.
 */
async function overlapping(
  ctx: AppContext,
  vehicleId: string,
  tripId: number | null,
  dates: TripFields,
): Promise<TripRow | undefined> {
  if (!dates.startDate) return undefined;
  const { startDate, endDate } = dates;
  const [clash] = await ctx.db
    .select()
    .from(trips)
    .where(
      and(
        eq(trips.vehicleId, vehicleId),
        isNotNull(trips.startDate),
        tripId != null ? ne(trips.id, tripId) : undefined,
        endDate ? lte(trips.startDate, endDate) : undefined,
        or(isNull(trips.endDate), gte(trips.endDate, startDate)),
      ),
    )
    .limit(1);
  return clash;
}

const overlapError = (clash: TripRow) => `These dates overlap ${clash.name}.`;

/** Brings each of the vehicle's trips with dates up to date, earliest first. */
async function collectOpenTrips(ctx: AppContext, vehicleId: string): Promise<void> {
  const open = await ctx.db
    .select()
    .from(trips)
    .where(and(eq(trips.vehicleId, vehicleId), isNotNull(trips.startDate)))
    .orderBy(trips.startDate, trips.id);
  for (const row of open) await collectInto(ctx, row);
}

/**
 * Takes into a trip with dates the finished drives and charges that started
 * within its dates, unless they're in another trip or were taken out of this
 * one. Run whenever trips are read, so what's driven shows up without asking.
 */
async function collectInto(ctx: AppContext, row: TripRow): Promise<void> {
  if (!row.startDate || !row.timeZone) return;
  const range = rangeOf(row.startDate, row.endDate ?? row.startDate, row.timeZone);
  const from = new Date(range.from);
  const to = row.endDate ? new Date(Math.min(range.to, Date.now())) : new Date();
  if (to <= from) return;
  const vehicleId = row.vehicleId;
  const found = await activitiesBetween(ctx, vehicleId, from, to);
  if (found.length === 0) return;
  const keptOut = await ctx.db
    .select({ kind: tripExclusions.kind, activityId: tripExclusions.activityId })
    .from(tripExclusions)
    .where(eq(tripExclusions.tripId, row.id));
  // Whatever's in a trip already, this one or another, stays where it is. Left
  // out up front, not just to the conflict: Postgres spends an id on every row
  // offered, and this runs on every read.
  const linked = await ctx.db
    .select({ kind: tripActivities.kind, activityId: tripActivities.activityId })
    .from(tripActivities)
    .where(and(eq(tripActivities.vehicleId, vehicleId), pairIn(tripActivities, found)));
  const out = new Set([...keptOut, ...linked].map((e) => `${e.kind}:${e.activityId}`));
  const values = found
    .filter((a) => !out.has(`${a.kind}:${a.activityId}`))
    .map((a) => ({ ...a, tripId: row.id, vehicleId }));
  if (values.length === 0) return;
  // Should another request link one first.
  const added = await ctx.db
    .insert(tripActivities)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: tripActivities.id });
  if (added.length > 0) await touch(ctx, row.id);
}

/** The vehicle's finished drives and charges that started in a window. */
async function activitiesBetween(
  ctx: AppContext,
  vehicleId: string,
  from: Date,
  to: Date,
): Promise<{ kind: TripActivityKind; activityId: number }[]> {
  const refs = (kind: TripActivityKind, items: { id: number; endedAt: unknown }[]) =>
    items.filter((i) => i.endedAt != null).map((i) => ({ kind, activityId: i.id }));
  if (isTeslaMateVehicle(vehicleId)) {
    const places = await placeContext(ctx);
    const window = { from, to, limit: WINDOW_LIMIT };
    return [
      ...refs('drive', await ctx.teslamate.drives(vehicleId, places, window)),
      ...refs('charge', await ctx.teslamate.chargingSessions(vehicleId, places, window)),
    ];
  }
  const driveRows = await ctx.db
    .select({ id: drives.id, endedAt: drives.endedAt })
    .from(drives)
    .where(drivesBetween(vehicleId, from, to))
    .limit(WINDOW_LIMIT);
  const sessionRows = await ctx.db
    .select({ id: chargingSessions.id, endedAt: chargingSessions.endedAt })
    .from(chargingSessions)
    .where(sessionsBetween(vehicleId, from, to))
    .limit(WINDOW_LIMIT);
  return [...refs('drive', driveRows), ...refs('charge', sessionRows)];
}

/** The vehicle's finished drives that started in a window. */
const drivesBetween = (vehicleId: string, from: Date, to: Date) =>
  and(
    eq(drives.vehicleId, vehicleId),
    gte(drives.startedAt, from),
    lte(drives.startedAt, to),
    isNotNull(drives.endedAt),
    // As in the drive list: shifting in place isn't a drive.
    or(isNull(drives.distanceKm), gte(drives.distanceKm, MIN_DRIVE_KM)),
  );

/** The vehicle's finished charges that started in a window. */
const sessionsBetween = (vehicleId: string, from: Date, to: Date) =>
  and(
    eq(chargingSessions.vehicleId, vehicleId),
    gte(chargingSessions.startedAt, from),
    lte(chargingSessions.startedAt, to),
    isNotNull(chargingSessions.endedAt),
  );

function toTripDto(row: TripRow): TripDto {
  return {
    id: row.id,
    vehicleId: row.vehicleId,
    name: row.name,
    notes: row.notes,
    startDate: row.startDate,
    endDate: row.endDate,
    timeZone: row.timeZone,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function findTrip(
  ctx: AppContext,
  vehicleId: string,
  tripId: string,
): Promise<TripRow | null> {
  const id = Number(tripId);
  if (!Number.isSafeInteger(id)) return null;
  const [row] = await ctx.db
    .select()
    .from(trips)
    .where(and(eq(trips.id, id), eq(trips.vehicleId, vehicleId)));
  return row ?? null;
}

async function vehicleExists(ctx: AppContext, vehicleId: string): Promise<boolean> {
  if (isTeslaMateVehicle(vehicleId)) {
    return ctx.teslamate.getVehicles().some((v) => v.id === vehicleId);
  }
  const [row] = await ctx.db
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(eq(vehicles.id, vehicleId));
  return row != null;
}

/** The linked records that can be read, from whichever source has the vehicle. */
async function loadActivities(
  ctx: AppContext,
  vehicleId: string,
  links: readonly { kind: TripActivityKind; activityId: number }[],
): Promise<{ drives: DriveDto[]; sessions: ChargingSessionDto[] }> {
  const ids = (kind: TripActivityKind) =>
    links.filter((l) => l.kind === kind).map((l) => l.activityId);
  const driveIds = ids('drive');
  const sessionIds = ids('charge');
  if (isTeslaMateVehicle(vehicleId)) {
    const places = await placeContext(ctx);
    return {
      drives: await ctx.teslamate.drivesByIds(vehicleId, driveIds, places),
      sessions: await ctx.teslamate.chargingSessionsByIds(vehicleId, sessionIds, places),
    };
  }
  const driveRows = driveIds.length
    ? await ctx.db
        .select()
        .from(drives)
        .where(and(eq(drives.vehicleId, vehicleId), inArray(drives.id, driveIds)))
        .orderBy(desc(drives.startedAt))
    : [];
  const sessionRows = sessionIds.length
    ? await ctx.db
        .select()
        .from(chargingSessions)
        .where(
          and(eq(chargingSessions.vehicleId, vehicleId), inArray(chargingSessions.id, sessionIds)),
        )
        .orderBy(desc(chargingSessions.startedAt))
    : [];
  return {
    drives: await driveDtos(ctx, vehicleId, driveRows),
    sessions: await sessionDtos(ctx, vehicleId, sessionRows),
  };
}

async function assignments(ctx: AppContext, vehicleId: string): Promise<TripAssignmentDto[]> {
  return ctx.db
    .select({
      kind: tripActivities.kind,
      activityId: tripActivities.activityId,
      tripId: trips.id,
      tripName: trips.name,
    })
    .from(tripActivities)
    .innerJoin(trips, eq(trips.id, tripActivities.tripId))
    .where(eq(tripActivities.vehicleId, vehicleId));
}

/** Each drive's route, thinned like History's, read live: nothing about it is stored. */
async function tripRoute(
  ctx: AppContext,
  vehicleId: string,
  driveIds: number[],
): Promise<TripRouteDto[]> {
  if (driveIds.length === 0) return [];
  const rows = isTeslaMateVehicle(vehicleId)
    ? await ctx.teslamate.drivePoints(vehicleId, driveIds)
    : await ctx.db
        .select({
          ts: locationPoints.ts,
          lat: locationPoints.lat,
          lon: locationPoints.lon,
          altitude: locationPoints.altitude,
          driveId: locationPoints.driveId,
        })
        .from(locationPoints)
        .where(inArray(locationPoints.driveId, driveIds))
        .orderBy(locationPoints.ts);
  const first = rows[0];
  const last = rows.at(-1);
  if (!first || !last) return [];
  const kept = thinTrack(rows, (r) => r.driveId, trackToleranceM(first.ts, last.ts));
  const routes = new Map<number, TripRouteDto>();
  for (const r of kept) {
    if (r.driveId == null) continue;
    let route = routes.get(r.driveId);
    if (!route) routes.set(r.driveId, (route = { driveId: r.driveId, points: [], profile: [] }));
    route.points.push([r.lat, r.lon]);
  }
  // From every reading: thinning keeps a road's bends, not its summits.
  for (const [driveId, profile] of tripProfiles(rows)) {
    const route = routes.get(driveId);
    if (route) route.profile = profile;
  }
  return [...routes.values()];
}
