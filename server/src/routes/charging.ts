import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ChargingCurvePointDto, ChargingSessionDto, WallboxDto } from '../api-types.js';
import type { AppContext } from '../context.js';
import {
  type ChargingSettings,
  type SavedLocation,
  type Spot,
  estimateCost,
  sessionPlace,
  sessionRate,
  wallboxSpots,
} from '../services/locations.js';
import { listLimit, listWindowSchema } from './list-window.js';
import { loadLocations } from './locations.js';
import { getChargingSettings } from './settings.js';
import { chargingCurvePoints, chargingSessions, wallboxReadings, wallboxes } from '../db/schema.js';
import {
  curveForDisplay,
  estimatedForecast,
  forecastForDisplay,
  liveCurvePoint,
  withOpeningSoc,
} from '../services/charging-curve.js';

/** Tolerance for Rivian's clock running ahead of the server's. */
const CLOCK_SLACK_MS = 60_000;
import { isChargingState, socReadingsBetween } from '../services/charging-time.js';
import { latestNumber, stateTimeline } from '../services/state-history.js';
import { chargingWindow, loadChargeSpans } from '../services/charge-spans.js';
import { isTeslaMateVehicle } from '../teslamate/ids.js';

const patchSchema = z.object({
  cost: z.union([z.string(), z.number()]).nullable(),
});

export async function chargingRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get<{ Params: { id: string } }>(
    '/api/vehicles/:id/charging-sessions',
    async (request): Promise<ChargingSessionDto[]> => {
      const q = listWindowSchema.parse(request.query);
      if (isTeslaMateVehicle(request.params.id)) {
        return ctx.teslamate.chargingSessions(request.params.id, await placeContext(ctx), {
          ...q,
          limit: listLimit(q),
        });
      }
      const rows = await ctx.db
        .select()
        .from(chargingSessions)
        .where(
          and(
            eq(chargingSessions.vehicleId, request.params.id),
            q.from ? gte(chargingSessions.startedAt, q.from) : undefined,
            q.to ? lte(chargingSessions.startedAt, q.to) : undefined,
          ),
        )
        .orderBy(desc(chargingSessions.startedAt))
        .limit(listLimit(q));
      const places = await placeContext(ctx);
      const capacityKwh = await packCapacityKwh(ctx, request.params.id);
      const limits = await sessionLimits(ctx, rows);
      const oldest = rows.at(-1);
      const spans = oldest
        ? await loadChargeSpans(ctx.db, request.params.id, oldest.startedAt, new Date())
        : [];
      return rows.map((row) =>
        toSessionDto(
          row,
          places,
          chargingWindow(spans, row.startedAt, row.endedAt),
          capacityKwh,
          limits.get(row.id) ?? null,
        ),
      );
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    '/api/charging-sessions/:sessionId/curve',
    async (request): Promise<ChargingCurvePointDto[]> =>
      rivianCurve(ctx, Number(request.params.sessionId)),
  );

  app.get<{ Params: { id: string; sessionId: string } }>(
    '/api/vehicles/:id/charging-sessions/:sessionId/curve',
    async (request): Promise<ChargingCurvePointDto[]> => {
      const { id } = request.params;
      const sessionId = Number(request.params.sessionId);
      return isTeslaMateVehicle(id)
        ? ctx.teslamate.chargingCurve(id, sessionId)
        : rivianCurve(ctx, sessionId, id);
    },
  );

  app.patch<{ Params: { sessionId: string } }>(
    '/api/charging-sessions/:sessionId',
    async (request, reply) => {
      const body = patchSchema.parse(request.body);
      const updated = await ctx.db
        .update(chargingSessions)
        .set({ cost: body.cost == null ? null : String(body.cost), costEdited: body.cost != null })
        .where(eq(chargingSessions.id, Number(request.params.sessionId)))
        .returning();
      if (!updated[0]) return reply.code(404).send({ error: 'Not found' });
      return toSessionDto(
        updated[0],
        await placeContext(ctx),
        null,
        await packCapacityKwh(ctx, updated[0].vehicleId),
        (await sessionLimits(ctx, updated)).get(updated[0].id) ?? null,
      );
    },
  );

  app.get('/api/wallboxes', async (): Promise<WallboxDto[]> => {
    const boxes = await ctx.db.select().from(wallboxes);
    const result: WallboxDto[] = [];
    for (const box of boxes) {
      const latest = await ctx.db
        .select()
        .from(wallboxReadings)
        .where(eq(wallboxReadings.wallboxId, box.wallboxId))
        .orderBy(desc(wallboxReadings.ts))
        .limit(1);
      result.push({
        wallboxId: box.wallboxId,
        name: box.name,
        model: box.model,
        serialNumber: box.serialNumber,
        softwareVersion: box.softwareVersion,
        maxAmps: box.maxAmps,
        maxPower: box.maxPower,
        latitude: box.latitude,
        longitude: box.longitude,
        latest: latest[0]
          ? {
              ts: latest[0].ts.toISOString(),
              chargingStatus: latest[0].chargingStatus,
              power: latest[0].power,
              currentVoltage: latest[0].currentVoltage,
              currentAmps: latest[0].currentAmps,
            }
          : null,
      });
    }
    return result;
  });
}

/** A session's curve; empty if missing or (with `vehicleId`) another vehicle's. */
async function rivianCurve(
  ctx: AppContext,
  sessionId: number,
  vehicleId?: string,
): Promise<ChargingCurvePointDto[]> {
  if (!Number.isSafeInteger(sessionId)) return [];
  const [session] = await ctx.db
    .select({
      vehicleId: chargingSessions.vehicleId,
      startedAt: chargingSessions.startedAt,
      endedAt: chargingSessions.endedAt,
      chargingSince: chargingSessions.chargingSince,
      startSoc: chargingSessions.startSoc,
    })
    .from(chargingSessions)
    .where(eq(chargingSessions.id, sessionId));
  if (vehicleId != null && session?.vehicleId !== vehicleId) return [];
  const rows = await ctx.db
    .select()
    .from(chargingCurvePoints)
    .where(eq(chargingCurvePoints.sessionId, sessionId))
    .orderBy(chargingCurvePoints.ts)
    .limit(20_000);
  // Nothing recorded can be from the future; such rows were forecast.
  const latest = Date.now() + CLOCK_SLACK_MS;
  // Drawn over just the time it charged, from recorded charger status.
  const window = session
    ? chargingWindow(
        await loadChargeSpans(
          ctx.db,
          session.vehicleId,
          session.startedAt,
          session.endedAt ?? new Date(),
        ),
        session.startedAt,
        session.endedAt,
      )
    : null;
  const clipped = curveForDisplay(
    rows.filter((r) => r.source === 'forecast' || r.ts.getTime() <= latest),
    window,
  );
  // Starts at the level the session shows it charging from.
  const curve =
    session && clipped[0] && clipped[0].soc == null
      ? withOpeningSoc(clipped, await socAt(ctx, session, clipped[0].ts))
      : clipped;
  // Only while it's actually charging: stopped but still plugged in, or
  // unplugged, there's nothing left to forecast.
  const charging = session != null && session.endedAt == null && session.chargingSince != null;
  const live = session && charging ? ctx.bus.latestChargingSession(session.vehicleId) : null;
  const liveCharging = live && isChargingState(String(live.vehicleChargerState?.value ?? ''));
  // The curve reaches the level shown with it, not just the last graph bar.
  const tail = liveCharging && curve.length > 0 ? liveCurvePoint(live, curve.at(-1)) : null;
  const recorded = tail ? [...curve, tail] : curve;
  const forecast = forecastForDisplay(rows, recorded, charging);
  // Without Rivian's forecast, the app's own.
  const estimated =
    liveCharging && forecast.length === 0
      ? forecastForDisplay(estimatedForecast(live), recorded, true)
      : [];
  if (recorded.length > 0) {
    return [
      ...recorded.map((r) => ({ ts: r.ts.toISOString(), powerKw: r.powerKw, soc: r.soc })),
      ...forecast.map((r) => ({
        ts: r.ts.toISOString(),
        powerKw: null,
        soc: r.soc,
        projected: true,
      })),
      ...estimated.map((r) => ({
        ts: r.ts.toISOString(),
        powerKw: null,
        soc: r.soc,
        projected: true,
        estimated: true,
      })),
    ];
  }
  return socCurveFromState(ctx, sessionId);
}

export interface PlaceContext {
  settings: ChargingSettings;
  locations: SavedLocation[];
  wallboxes: Spot[];
}

export async function placeContext(ctx: AppContext): Promise<PlaceContext> {
  const boxes = await ctx.db
    .select({ latitude: wallboxes.latitude, longitude: wallboxes.longitude })
    .from(wallboxes);
  return {
    settings: await getChargingSettings(ctx),
    locations: await loadLocations(ctx),
    wallboxes: wallboxSpots(boxes),
  };
}

/**
 * Without a recorded power curve, battery level over the session from the
 * vehicle states RivianMate recorded (empty if it wasn't recording then).
 */
async function socCurveFromState(
  ctx: AppContext,
  sessionId: number,
): Promise<ChargingCurvePointDto[]> {
  const [session] = await ctx.db
    .select({
      vehicleId: chargingSessions.vehicleId,
      startedAt: chargingSessions.startedAt,
      endedAt: chargingSessions.endedAt,
    })
    .from(chargingSessions)
    .where(eq(chargingSessions.id, sessionId));
  if (!session) return [];
  const start = session.startedAt.getTime();
  const end = session.endedAt?.getTime() ?? Date.now();
  const history = await stateTimeline(
    ctx.db,
    session.vehicleId,
    ['batteryLevel'],
    session.startedAt,
    new Date(end),
  );
  return socReadingsBetween(
    history.map((h) => h.state),
    start,
    end,
  ).map((r) => ({ ts: new Date(r.at).toISOString(), powerKw: null, soc: r.soc }));
}

/**
 * Battery level at a moment in a session: the last recorded reading at or
 * before it, else the level the session started at.
 */
async function socAt(
  ctx: AppContext,
  session: { vehicleId: string; startedAt: Date; startSoc: number | null },
  at: Date,
): Promise<number | null> {
  const history = await stateTimeline(
    ctx.db,
    session.vehicleId,
    ['batteryLevel'],
    session.startedAt,
    at,
  );
  const reading = socReadingsBetween(
    history.map((h) => h.state),
    Number.NEGATIVE_INFINITY,
    at.getTime(),
  ).at(-1);
  return reading?.soc ?? session.startSoc;
}

/** The latest pack capacity recorded for the vehicle (kWh). */
async function packCapacityKwh(ctx: AppContext, vehicleId: string): Promise<number | null> {
  return latestNumber(ctx.db, vehicleId, 'batteryCapacity');
}

/**
 * Each session's charge limit: the last one recorded at or before it ended
 * (or now, while it's under way), which is what it was charging toward.
 */
async function sessionLimits(
  ctx: AppContext,
  sessions: readonly { id: number }[],
): Promise<Map<number, number>> {
  if (sessions.length === 0) return new Map();
  const rows = await ctx.db.execute<{ id: number; soc_limit: number | null }>(sql`
    SELECT s.id, (
      SELECT c.num FROM state_changes c
      WHERE c.vehicle_seq = (SELECT seq FROM vehicles WHERE id = s.vehicle_id)
        AND c.field_id = (SELECT id FROM state_fields WHERE name = 'batteryLimit')
        AND c.num IS NOT NULL AND c.at <= COALESCE(s.ended_at, now())
      ORDER BY c.at DESC LIMIT 1
    ) AS soc_limit
    FROM charging_sessions s
    WHERE s.id IN (${sql.join(
      sessions.map((s) => sql`${s.id}`),
      sql`, `,
    )})
  `);
  return new Map(rows.flatMap((r) => (r.soc_limit == null ? [] : [[Number(r.id), r.soc_limit]])));
}

/**
 * Energy the battery gained over a session, from its battery levels and
 * the pack's capacity: what reached the pack, so a little under what the
 * charger delivered.
 */
export function socEnergyKwh(
  row: { startSoc: number | null; endSoc: number | null },
  capacityKwh: number | null,
): number | null {
  if (row.startSoc == null || row.endSoc == null || capacityKwh == null) return null;
  const kwh = ((row.endSoc - row.startSoc) / 100) * capacityKwh;
  return kwh > 0 ? kwh : null;
}

function toSessionDto(
  row: typeof chargingSessions.$inferSelect,
  places: PlaceContext,
  charging: { from: Date; to: Date } | null = null,
  capacityKwh: number | null = null,
  socLimit: number | null = null,
): ChargingSessionDto {
  const place = sessionPlace(row, places.locations, places.wallboxes);
  const { location, isHome } = place;
  // Estimates use today's rates, so changing one reprices past estimates;
  // a cost recorded or entered for the session always wins. Until Rivian
  // reports the energy (often only after unplugging), it's estimated from
  // the battery gained.
  const estimatedEnergyKwh = row.energyKwh == null ? socEnergyKwh(row, capacityKwh) : null;
  const estimatedCost =
    row.cost == null
      ? estimateCost(row.energyKwh ?? estimatedEnergyKwh, sessionRate(place, places.locations))
      : null;
  return {
    id: row.id,
    vehicleId: row.vehicleId,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    chargerId: row.chargerId,
    chargerType: row.chargerType,
    startSoc: row.startSoc,
    endSoc: row.endSoc,
    chargingSeconds: row.chargingSeconds,
    chargingSince: row.chargingSince?.toISOString() ?? null,
    chargingStartedAt: charging?.from.toISOString() ?? null,
    chargingEndedAt: charging?.to.toISOString() ?? null,
    energyKwh: row.energyKwh,
    packKwh: row.packKwh,
    thermalKwh: row.thermalKwh,
    rangeAddedKm: row.rangeAddedKm,
    avgPowerKw: row.avgPowerKw,
    maxPowerKw: row.maxPowerKw,
    cost: row.cost,
    // Estimates are priced in the rates' currency.
    currency: row.currency ?? (estimatedCost != null ? places.settings.currency : null),
    lat: row.lat,
    lon: row.lon,
    source: row.source,
    vendor: row.vendor,
    city: row.city,
    isPublic: row.isPublic,
    isHome,
    location: location && { id: location.id, name: location.name, isHome: location.isHome },
    estimatedCost,
    estimatedEnergyKwh,
    socLimit,
  };
}
