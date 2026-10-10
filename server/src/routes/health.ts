import { reportedCapacity, type CapacityReading } from "../services/reported-capacity.js";
import { RVM_BATTERY_CHARACTERISTICS, RVM_BATTERY_STATE, decodeBatteryCharacteristics, decodeBatteryState } from "../rivian/parallax.js";
import { stateNumber } from "../services/state-utils.js";
import { and, asc, eq, gte } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  BatteryHealthDto,
  OtaTimelineDto,
  PhantomDrainDto,
  TirePressurePointDto,
} from "../api-types.js";
import type { AppContext } from "../context.js";
import { parallaxLatest, vehicleStateSnapshots } from "../db/schema.js";
import { stateString } from "../services/state-utils.js";
import { phantomDrain } from "../services/health.js";

const daysQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

const drainQuery = daysQuery.extend({ tz: z.string().max(64).optional() });

/** An IANA time zone the runtime knows, or UTC. */
function validTimeZone(tz: string | undefined): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/** Numeric value of a state field in the snapshot JSON; NULL for placeholders. */
function numericField(field: string) {
  const path = sql.raw(`data->'${field}'->>'value'`);
  return sql`CASE WHEN ${path} ~ '^-?[0-9]+([.][0-9]+)?$' THEN (${path})::float8 END`;
}

const TIRES = {
  frontLeft: "tirePressureFrontLeft",
  frontRight: "tirePressureFrontRight",
  rearLeft: "tirePressureRearLeft",
  rearRight: "tirePressureRearRight",
} as const;

export async function healthRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get<{ Params: { id: string } }>(
    "/api/vehicles/:id/health/phantom-drain",
    async (request): Promise<PhantomDrainDto> => {
      const { days, tz } = drainQuery.parse(request.query);
      const since = new Date(Date.now() - days * 86_400_000);
      const rows = await ctx.db
        .select({
          ts: vehicleStateSnapshots.ts,
          batteryLevel: vehicleStateSnapshots.batteryLevel,
          mileageM: vehicleStateSnapshots.mileageM,
          chargerStatus: vehicleStateSnapshots.chargerStatus,
          gear: sql<string | null>`${vehicleStateSnapshots.data}->'gearStatus'->>'value'`,
        })
        .from(vehicleStateSnapshots)
        .where(
          and(
            eq(vehicleStateSnapshots.vehicleId, request.params.id),
            gte(vehicleStateSnapshots.ts, since),
          ),
        )
        .orderBy(asc(vehicleStateSnapshots.ts));
      return phantomDrain(rows, validTimeZone(tz));
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/vehicles/:id/ota",
    async (request): Promise<OtaTimelineDto> => {
      const vehicleId = request.params.id;
      const history = await ctx.db.execute<{ version: string; first_seen: string }>(sql`
        SELECT version, MIN(ts) AS first_seen
        FROM (
          SELECT ts, data->'otaCurrentVersion'->>'value' AS version
          FROM vehicle_state_snapshots
          WHERE vehicle_id = ${vehicleId} AND data ? 'otaCurrentVersion'
        ) v
        WHERE version IS NOT NULL AND version NOT IN ('', '0.0.0')
        GROUP BY version
        ORDER BY first_seen DESC
      `);
      const state = ctx.monitor.getState(vehicleId) ?? {};
      const current = stateString(state, "otaCurrentVersion");
      const availableRaw = stateString(state, "otaAvailableVersion");
      const available =
        availableRaw && availableRaw !== "0.0.0" && availableRaw !== current ? availableRaw : null;

      return {
        current,
        available,
        versions: history.map((h) => ({
          version: h.version,
          firstSeen: new Date(h.first_seen).toISOString(),
        })),
      };
    },
  );

  // Rivian's links expire within the hour, so each click gets a fresh one.
  app.get<{ Params: { id: string; version: string } }>(
    "/api/vehicles/:id/ota/notes/:version",
    async (request, reply) => {
      const url = await ctx.monitor.getReleaseNotesUrl(request.params.id, request.params.version);
      if (!url) {
        return reply
          .code(404)
          .type("text/plain")
          .send("Rivian doesn't have release notes for this version right now.");
      }
      return reply.redirect(url);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/vehicles/:id/health/tires",
    async (request): Promise<TirePressurePointDto[]> => {
      const { days } = daysQuery.parse(request.query);
      const since = new Date(Date.now() - days * 86_400_000);
      const bucket = days <= 7 ? "1 hour" : days <= 30 ? "6 hours" : "1 day";
      const rows = await ctx.db.execute<{
        bucket: string;
        front_left: number | null;
        front_right: number | null;
        rear_left: number | null;
        rear_right: number | null;
      }>(sql`
        SELECT date_bin(${bucket}::interval, ts, TIMESTAMPTZ '2020-01-01') AS bucket,
               AVG(${numericField(TIRES.frontLeft)}) AS front_left,
               AVG(${numericField(TIRES.frontRight)}) AS front_right,
               AVG(${numericField(TIRES.rearLeft)}) AS rear_left,
               AVG(${numericField(TIRES.rearRight)}) AS rear_right
        FROM vehicle_state_snapshots
        WHERE vehicle_id = ${request.params.id}
          AND ts >= ${since.toISOString()}::timestamptz
          AND data ?| array['tirePressureFrontLeft','tirePressureFrontRight','tirePressureRearLeft','tirePressureRearRight']
        GROUP BY 1 ORDER BY 1
      `);
      // Values are in bar, as Rivian reports them.
      return rows
        .map((r) => ({
          ts: new Date(r.bucket).toISOString(),
          frontLeft: r.front_left,
          frontRight: r.front_right,
          rearLeft: r.rear_left,
          rearRight: r.rear_right,
        }))
        .filter((r) => r.frontLeft ?? r.frontRight ?? r.rearLeft ?? r.rearRight);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/vehicles/:id/health/battery",
    async (request): Promise<BatteryHealthDto> => {
      const snapshots = await ctx.db.execute<{ at: string; reported_at: string | null; kwh: number }>(sql`
        SELECT DISTINCT ON (date_trunc('day', ts AT TIME ZONE 'UTC'))
               ts AS at, data->'batteryCapacity'->>'timeStamp' AS reported_at,
               ${numericField("batteryCapacity")} AS kwh
        FROM vehicle_state_snapshots
        WHERE vehicle_id = ${request.params.id}
          AND ${numericField("batteryCapacity")} > 0
          AND ${numericField("batteryCapacity")} <= 500
        ORDER BY date_trunc('day', ts AT TIME ZONE 'UTC'), ts DESC, id DESC
      `);
      const readings: CapacityReading[] = snapshots.map(r => ({
        at: r.reported_at && Number.isFinite(Date.parse(r.reported_at)) ? r.reported_at : new Date(r.at).toISOString(),
        kwh: r.kwh,
      }));
      const state = ctx.monitor.getState(request.params.id);
      const liveCapacity = stateNumber(state ?? {}, "batteryCapacity");
      const liveRecord = state?.batteryCapacity;
      const liveAt = liveRecord && "timeStamp" in liveRecord ? liveRecord.timeStamp : null;
      if (liveCapacity != null && typeof liveAt === "string") readings.push({ kwh: liveCapacity, at: liveAt });
      const messages = await ctx.db.select().from(parallaxLatest).where(eq(parallaxLatest.vehicleId, request.params.id));
      let ratedCapacity: CapacityReading | null = null;
      for (const message of messages) {
        const characteristics = message.rvm === RVM_BATTERY_CHARACTERISTICS ? decodeBatteryCharacteristics(message.payload) : null;
        const at = (message.messageAt ?? message.receivedAt).toISOString();
        if (characteristics?.ratedCapacityKwh != null) ratedCapacity = { kwh: characteristics.ratedCapacityKwh, at };
        const capacity = message.rvm === RVM_BATTERY_CHARACTERISTICS ? characteristics?.capacityKwh
          : message.rvm === RVM_BATTERY_STATE ? decodeBatteryState(message.payload)?.capacityKwh : null;
        if (capacity != null) readings.push({ kwh: capacity, at: (message.messageAt ?? message.receivedAt).toISOString() });
      }

      return {
        ...reportedCapacity(readings),
        ratedCapacity,
      };
    },
  );
}
