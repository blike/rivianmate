import { reportedCapacity, type CapacityReading } from '../services/reported-capacity.js';
import {
  RVM_BATTERY_CHARACTERISTICS,
  RVM_BATTERY_STATE,
  RVM_WHEELS,
  decodeBatteryCharacteristics,
  decodeBatteryState,
  decodeWheels,
} from '../rivian/parallax/index.js';
import { stateNumber } from '../services/state-utils.js';
import { and, eq, gte, isNull, lte, or } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type {
  BatteryHealthDto,
  BatteryWindowDto,
  OtaTimelineDto,
  PhantomDrainDto,
  TirePressurePointDto,
  TireRotationDto,
} from '../api-types.js';
import type { AppContext } from '../context.js';
import { chargingSessions, drives, parallaxLatest } from '../db/schema.js';
import { stateString } from '../services/state-utils.js';
import { type BusySpan, drainSnapshots, parkedLoss, phantomDrain } from '../services/health.js';
import { stampedAt } from '../services/charging-time.js';
import { OTA_HISTORY_FIELDS, otaHistory } from '../services/ota-history.js';
import type { VehicleState } from '../rivian/types.js';
import {
  END_OF_TIME,
  bucketSeries,
  changesBetween,
  latestNumber,
  numericSeries,
  stateTimeline,
} from '../services/state-history.js';
import { isTeslaMateVehicle } from '../teslamate/ids.js';

const daysQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

const drainQuery = daysQuery.extend({ tz: z.string().max(64).optional() });

/** An IANA time zone the runtime knows, or UTC. */
function validTimeZone(tz: string | undefined): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

const TIRES = {
  frontLeft: 'tirePressureFrontLeft',
  frontRight: 'tirePressureFrontRight',
  rearLeft: 'tirePressureRearLeft',
  rearRight: 'tirePressureRearRight',
} as const;

/** Recorded moments of the fields drain reads, over [from, to]. */
async function drainTimeline(ctx: AppContext, vehicleId: string, from: Date, to: Date) {
  return stateTimeline(
    ctx.db,
    vehicleId,
    ['batteryLevel', 'vehicleMileage', 'chargerStatus', 'gearStatus'],
    from,
    to,
    { heartbeats: true },
  );
}

function drainRowsFrom(history: Awaited<ReturnType<typeof drainTimeline>>) {
  const stamped = (state: VehicleState, field: string) => {
    const value = stateNumber(state, field);
    return value == null ? null : { value, at: stampedAt(state, field, Infinity) };
  };
  return drainSnapshots(
    history.map(({ at, state }) => ({
      at,
      batteryLevel: stamped(state, 'batteryLevel'),
      mileage: stamped(state, 'vehicleMileage'),
      chargerStatus: stateString(state, 'chargerStatus'),
      gear: stateString(state, 'gearStatus'),
    })),
  );
}

/** Drives and plug-ins overlapping [from, to], with the levels they began and ended at. */
async function busySpans(
  ctx: AppContext,
  vehicleId: string,
  from: Date,
  to: Date,
): Promise<BusySpan[]> {
  const overlaps = (start: AnyPgColumn, end: AnyPgColumn) =>
    and(lte(start, to), or(isNull(end), gte(end, from)));
  const [driveRows, sessionRows] = await Promise.all([
    ctx.db
      .select({
        start: drives.startedAt,
        end: drives.endedAt,
        startLevel: drives.startBattery,
        endLevel: drives.endBattery,
      })
      .from(drives)
      .where(and(eq(drives.vehicleId, vehicleId), overlaps(drives.startedAt, drives.endedAt))),
    ctx.db
      .select({
        start: chargingSessions.startedAt,
        end: chargingSessions.endedAt,
        startLevel: chargingSessions.startSoc,
        endLevel: chargingSessions.endSoc,
      })
      .from(chargingSessions)
      .where(
        and(
          eq(chargingSessions.vehicleId, vehicleId),
          overlaps(chargingSessions.startedAt, chargingSessions.endedAt),
        ),
      ),
  ]);
  return [...driveRows, ...sessionRows];
}

const batteryWindowQuery = z.object({
  from: z.coerce.date(),
  to: z.coerce.date().optional(),
});

export async function healthRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get<{ Params: { id: string } }>(
    '/api/vehicles/:id/battery-window',
    async (request): Promise<BatteryWindowDto> => {
      const { from, to = new Date() } = batteryWindowQuery.parse(request.query);
      const id = request.params.id;
      if (isTeslaMateVehicle(id)) return ctx.teslamate.batteryWindow(id, from, to);
      const [history, spans] = await Promise.all([
        stateTimeline(ctx.db, id, ['batteryLevel'], from, to),
        busySpans(ctx, id, from, to),
      ]);
      const readings = history.flatMap(({ at, state }) => {
        const level = stateNumber(state, 'batteryLevel');
        return level == null ? [] : [{ at, level }];
      });
      const levels = readings.map((r) => r.level);
      const levelAt = (t: Date) =>
        readings.findLast((r) => r.at <= t.getTime())?.level ?? readings[0]?.level ?? null;
      const parked = parkedLoss(spans, from, to, levelAt);
      return {
        capacityKwh: await latestNumber(ctx.db, request.params.id, 'batteryCapacity'),
        startLevel: levels[0] ?? null,
        endLevel: levels.at(-1) ?? null,
        parkedLossPct: parked.lossPct,
        parkedHours: parked.parkedHours,
      };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/vehicles/:id/health/phantom-drain',
    async (request): Promise<PhantomDrainDto> => {
      const { days, tz } = drainQuery.parse(request.query);
      if (isTeslaMateVehicle(request.params.id)) {
        return ctx.teslamate.phantomDrain(request.params.id, days, validTimeZone(tz));
      }
      const since = new Date(Date.now() - days * 86_400_000);
      const rows = drainRowsFrom(await drainTimeline(ctx, request.params.id, since, new Date()));
      return phantomDrain(rows, validTimeZone(tz));
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/vehicles/:id/ota',
    async (request): Promise<OtaTimelineDto> => {
      const vehicleId = request.params.id;
      if (isTeslaMateVehicle(vehicleId)) return ctx.teslamate.ota(vehicleId);
      const firstSeen = new Map<string, number>();
      const changes = await changesBetween(
        ctx.db,
        vehicleId,
        OTA_HISTORY_FIELDS,
        new Date(0),
        END_OF_TIME,
      );
      for (const { field, value, at } of changes) {
        if (field !== 'otaCurrentVersion') continue;
        const version = value == null ? '' : String(value);
        if (version === '' || version === '0.0.0' || firstSeen.has(version)) continue;
        firstSeen.set(version, at);
      }
      const history = [...firstSeen]
        .sort(([, a], [, b]) => b - a)
        .map(([version, at]) => ({ version, first_seen: at }));
      const withNotes = await ctx.monitor.releaseNotesVersions(vehicleId);
      const state = ctx.monitor.getState(vehicleId) ?? {};
      const current = stateString(state, 'otaCurrentVersion');
      const availableRaw = stateString(state, 'otaAvailableVersion');
      const available =
        availableRaw && availableRaw !== '0.0.0' && availableRaw !== current ? availableRaw : null;

      const versions = history.map((h) => ({
        version: h.version,
        firstSeen: new Date(h.first_seen).toISOString(),
        hasNotes: withNotes.has(h.version),
      }));
      // Live state reports a new version before a snapshot records it.
      if (current && current !== '0.0.0' && !versions.some((v) => v.version === current)) {
        versions.unshift({
          version: current,
          firstSeen: new Date().toISOString(),
          hasNotes: withNotes.has(current),
        });
      }
      return { current, available, versions, ...otaHistory(changes) };
    },
  );

  app.get<{ Params: { id: string; version: string } }>(
    '/api/vehicles/:id/ota/notes/:version',
    async (request, reply) => {
      const { id, version } = request.params;
      const pdf = isTeslaMateVehicle(id) ? null : await ctx.monitor.getReleaseNotes(id, version);
      if (!pdf) {
        return reply
          .code(404)
          .type('text/plain')
          .send(
            "Release notes for this version weren't saved before Rivian stopped offering them.",
          );
      }
      const filename = `rivian-${version.replace(/[^\w.-]/g, '')}-release-notes.pdf`;
      return reply
        .type('application/pdf')
        .header('Content-Disposition', `inline; filename="${filename}"`)
        .header('Cache-Control', 'private, max-age=86400')
        .send(pdf);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/vehicles/:id/health/tires',
    async (request): Promise<TirePressurePointDto[]> => {
      const { days } = daysQuery.parse(request.query);
      if (isTeslaMateVehicle(request.params.id)) {
        return ctx.teslamate.tirePressures(request.params.id, days);
      }
      const since = new Date(Date.now() - days * 86_400_000);
      const bucketMs = (days <= 7 ? 1 : days <= 30 ? 6 : 24) * 3600_000;
      const now = new Date();
      const byBucket = new Map<number, TirePressurePointDto>();
      for (const [position, field] of Object.entries(TIRES) as [keyof typeof TIRES, string][]) {
        const { opening, changes } = await numericSeries(
          ctx.db,
          request.params.id,
          field,
          since,
          now,
        );
        for (const b of bucketSeries(opening, changes, since.getTime(), now.getTime(), bucketMs)) {
          const point = byBucket.get(b.bucket) ?? {
            ts: new Date(b.bucket).toISOString(),
            frontLeft: null,
            frontRight: null,
            rearLeft: null,
            rearRight: null,
          };
          point[position] = b.avg;
          byBucket.set(b.bucket, point);
        }
      }
      // Values are in bar, as Rivian reports them.
      return [...byBucket.entries()].sort(([a], [b]) => a - b).map(([, point]) => point);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/vehicles/:id/health/tire-rotation',
    async (request): Promise<TireRotationDto | null> => {
      if (isTeslaMateVehicle(request.params.id)) return null;
      const [message] = await ctx.db
        .select()
        .from(parallaxLatest)
        .where(
          and(eq(parallaxLatest.vehicleId, request.params.id), eq(parallaxLatest.rvm, RVM_WHEELS)),
        );
      const fitted = message ? decodeWheels(message.payload).find((w) => w.installed) : undefined;
      if (!fitted) return null;
      // vehicleMileage is in metres; the topic's own odometer is the fallback.
      const mileageM = stateNumber(ctx.monitor.getState(request.params.id) ?? {}, 'vehicleMileage');
      const odometerM = mileageM != null && mileageM > 0 ? mileageM : fitted.odometerM;
      return {
        odometerAtLastRotationKm: fitted.odometerAtLastRotationM / 1000,
        intervalKm: fitted.rotationIntervalM / 1000,
        odometerKm: odometerM != null ? odometerM / 1000 : null,
        at: (message!.messageAt ?? message!.receivedAt).toISOString(),
      };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/vehicles/:id/health/battery',
    async (request): Promise<BatteryHealthDto> => {
      if (isTeslaMateVehicle(request.params.id)) {
        return ctx.teslamate.batteryHealth(request.params.id);
      }
      // The last reading of each (UTC) day.
      const byDay = new Map<string, CapacityReading>();
      const changes = await changesBetween(
        ctx.db,
        request.params.id,
        ['batteryCapacity'],
        new Date(0),
        END_OF_TIME,
      );
      for (const { value, at } of changes) {
        if (typeof value !== 'number' || value <= 0 || value > 500) continue;
        const iso = new Date(at).toISOString();
        byDay.set(iso.slice(0, 10), { at: iso, kwh: value });
      }
      const readings: CapacityReading[] = [...byDay.values()];
      const state = ctx.monitor.getState(request.params.id);
      const liveCapacity = stateNumber(state ?? {}, 'batteryCapacity');
      const liveRecord = state?.batteryCapacity;
      const liveAt = liveRecord && 'timeStamp' in liveRecord ? liveRecord.timeStamp : null;
      if (liveCapacity != null && typeof liveAt === 'string')
        readings.push({ kwh: liveCapacity, at: liveAt });
      const messages = await ctx.db
        .select()
        .from(parallaxLatest)
        .where(eq(parallaxLatest.vehicleId, request.params.id));
      let ratedCapacity: CapacityReading | null = null;
      for (const message of messages) {
        const characteristics =
          message.rvm === RVM_BATTERY_CHARACTERISTICS
            ? decodeBatteryCharacteristics(message.payload)
            : null;
        const at = (message.messageAt ?? message.receivedAt).toISOString();
        if (characteristics?.ratedCapacityKwh != null)
          ratedCapacity = { kwh: characteristics.ratedCapacityKwh, at };
        const capacity =
          message.rvm === RVM_BATTERY_CHARACTERISTICS
            ? characteristics?.capacityKwh
            : message.rvm === RVM_BATTERY_STATE
              ? decodeBatteryState(message.payload)?.capacityKwh
              : null;
        if (capacity != null)
          readings.push({
            kwh: capacity,
            at: (message.messageAt ?? message.receivedAt).toISOString(),
          });
      }

      return {
        ...reportedCapacity(readings),
        ratedCapacity,
      };
    },
  );
}
