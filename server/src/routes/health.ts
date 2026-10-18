import { reportedCapacity, type CapacityReading } from '../services/reported-capacity.js';
import {
  RVM_BATTERY_CHARACTERISTICS,
  RVM_BATTERY_STATE,
  decodeBatteryCharacteristics,
  decodeBatteryState,
} from '../rivian/parallax/index.js';
import { stateNumber } from '../services/state-utils.js';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type {
  BatteryHealthDto,
  OtaTimelineDto,
  PhantomDrainDto,
  TirePressurePointDto,
} from '../api-types.js';
import type { AppContext } from '../context.js';
import { parallaxLatest } from '../db/schema.js';
import { stateString } from '../services/state-utils.js';
import { drainSnapshots, phantomDrain } from '../services/health.js';
import { stampedAt } from '../services/charging-time.js';
import type { VehicleState } from '../rivian/types.js';
import {
  END_OF_TIME,
  bucketSeries,
  changesBetween,
  numericSeries,
  stateTimeline,
} from '../services/state-history.js';

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

export async function healthRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get<{ Params: { id: string } }>(
    '/api/vehicles/:id/health/phantom-drain',
    async (request): Promise<PhantomDrainDto> => {
      const { days, tz } = drainQuery.parse(request.query);
      const since = new Date(Date.now() - days * 86_400_000);
      const history = await stateTimeline(
        ctx.db,
        request.params.id,
        ['batteryLevel', 'vehicleMileage', 'chargerStatus', 'gearStatus'],
        since,
        new Date(),
        { heartbeats: true },
      );
      const stamped = (state: VehicleState, field: string) => {
        const value = stateNumber(state, field);
        return value == null ? null : { value, at: stampedAt(state, field, Infinity) };
      };
      const rows = drainSnapshots(
        history.map(({ at, state }) => ({
          at,
          batteryLevel: stamped(state, 'batteryLevel'),
          mileage: stamped(state, 'vehicleMileage'),
          chargerStatus: stateString(state, 'chargerStatus'),
          gear: stateString(state, 'gearStatus'),
        })),
      );
      return phantomDrain(rows, validTimeZone(tz));
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/vehicles/:id/ota',
    async (request): Promise<OtaTimelineDto> => {
      const vehicleId = request.params.id;
      const firstSeen = new Map<string, number>();
      const changes = await changesBetween(
        ctx.db,
        vehicleId,
        ['otaCurrentVersion'],
        new Date(0),
        END_OF_TIME,
      );
      for (const { value, at } of changes) {
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
      return { current, available, versions };
    },
  );

  app.get<{ Params: { id: string; version: string } }>(
    '/api/vehicles/:id/ota/notes/:version',
    async (request, reply) => {
      const { id, version } = request.params;
      const pdf = await ctx.monitor.getReleaseNotes(id, version);
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
    '/api/vehicles/:id/health/battery',
    async (request): Promise<BatteryHealthDto> => {
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
