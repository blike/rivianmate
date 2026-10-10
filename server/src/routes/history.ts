import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  ChargeSpanDto,
  DriveDetailDto,
  DriveDto,
  DrivePlaceDto,
  HistoryPoint,
  LocationPointDto,
} from "../api-types.js";
import type { AppContext } from "../context.js";
import { drives, locationPoints } from "../db/schema.js";
import { driveElevation, maxSpeeds, mileageDistanceKm } from "../services/drive-detector.js";
import { driveEnergyKwh } from "../services/drive-metrics.js";
import type { VehicleState } from "../rivian/types.js";
import { stateNumber } from "../services/state-utils.js";
import { type Spot, nearbySpot } from "../services/home-charging.js";
import { homeContext } from "./charging.js";
import { loadChargeSpans } from "../services/charge-spans.js";

const METRIC_COLUMNS: Record<string, string> = {
  battery: "battery_level",
  range: "range_km",
  mileage: "mileage_m",
};

const historyQuerySchema = z.object({
  metric: z.enum(["battery", "range", "mileage"]).default("battery"),
  from: z.coerce.date().default(() => new Date(Date.now() - 7 * 86400_000)),
  to: z.coerce.date().default(() => new Date()),
  /** "raw": every snapshot, unaveraged. */
  bucket: z.enum(["raw", "5m", "15m", "1h", "6h", "1d"]).default("1h"),
});

const BUCKET_INTERVALS: Record<string, string> = {
  "5m": "5 minutes",
  "15m": "15 minutes",
  "1h": "1 hour",
  "6h": "6 hours",
  "1d": "1 day",
};

const MAX_LOCATIONS = 5000;

const rangeQuerySchema = z.object({
  from: z.coerce.date().default(() => new Date(Date.now() - 86400_000)),
  to: z.coerce.date().default(() => new Date()),
});

export async function historyRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.get<{ Params: { id: string } }>(
    "/api/vehicles/:id/history",
    async (request): Promise<HistoryPoint[]> => {
      const q = historyQuerySchema.parse(request.query);
      const column = METRIC_COLUMNS[q.metric]!;
      if (q.bucket === "raw") {
        const raw = await ctx.db.execute<{ ts: string; value: number }>(sql`
          SELECT ts, ${sql.raw(column)}::float8 AS value
          FROM vehicle_state_snapshots
          WHERE vehicle_id = ${request.params.id}
            AND ts BETWEEN ${q.from.toISOString()}::timestamptz AND ${q.to.toISOString()}::timestamptz
            AND ${sql.raw(column)} IS NOT NULL
          ORDER BY ts
        `);
        return raw.map((r) => ({ bucket: new Date(r.ts).toISOString(), avg: r.value, min: r.value, max: r.value }));
      }
      const interval = BUCKET_INTERVALS[q.bucket]!;
      const rows = await ctx.db.execute<{
        bucket: string;
        avg: number | null;
        min: number | null;
        max: number | null;
      }>(sql`
        SELECT date_bin(${interval}::interval, ts, TIMESTAMPTZ '2020-01-01') AS bucket,
               AVG(${sql.raw(column)})::float8 AS avg,
               MIN(${sql.raw(column)})::float8 AS min,
               MAX(${sql.raw(column)})::float8 AS max
        FROM vehicle_state_snapshots
        WHERE vehicle_id = ${request.params.id}
          AND ts BETWEEN ${q.from.toISOString()}::timestamptz AND ${q.to.toISOString()}::timestamptz
          AND ${sql.raw(column)} IS NOT NULL
        GROUP BY bucket ORDER BY bucket
      `);
      return rows.map((r) => ({
        bucket: new Date(r.bucket).toISOString(),
        avg: r.avg,
        min: r.min,
        max: r.max,
      }));
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/vehicles/:id/charge-spans",
    async (request): Promise<ChargeSpanDto[]> => {
      const q = rangeQuerySchema.parse(request.query);
      const spans = await loadChargeSpans(ctx.db, request.params.id, q.from, q.to);
      return spans.map((s) => ({ kind: s.kind, from: s.from.toISOString(), to: s.to.toISOString() }));
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/vehicles/:id/locations",
    async (request): Promise<LocationPointDto[]> => {
      const q = rangeQuerySchema.parse(request.query);
      // Long ranges are thinned evenly to about MAX_LOCATIONS points, so the
      // whole range is covered rather than just its start.
      const rows = await ctx.db.execute<{
        ts: string;
        lat: number;
        lon: number;
        speed_kmh: number | null;
        bearing: number | null;
        altitude: number | null;
      }>(sql`
        SELECT ts, lat, lon, speed_kmh, bearing, altitude FROM (
          SELECT ts, lat, lon, speed_kmh, bearing, altitude,
                 ROW_NUMBER() OVER (ORDER BY ts) AS rn,
                 COUNT(*) OVER () AS n
          FROM location_points
          WHERE vehicle_id = ${request.params.id}
            AND ts BETWEEN ${q.from.toISOString()}::timestamptz AND ${q.to.toISOString()}::timestamptz
        ) p
        WHERE rn % CEIL(n / ${MAX_LOCATIONS}::float8)::int = 0 OR rn = n OR rn = 1
        ORDER BY ts
      `);
      return rows.map((r) => ({
        ts: new Date(r.ts).toISOString(),
        lat: r.lat,
        lon: r.lon,
        speedKmh: r.speed_kmh,
        bearing: r.bearing,
        altitude: r.altitude,
      }));
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/vehicles/:id/drives",
    async (request): Promise<DriveDto[]> => {
      const rows = await ctx.db
        .select()
        .from(drives)
        .where(eq(drives.vehicleId, request.params.id))
        .orderBy(desc(drives.startedAt))
        .limit(200);
      // Drives recorded before elevation tracking: compute once and keep.
      // Only drives that actually have altitude readings are candidates, so
      // drives without any don't cost a query on every listing.
      const pending = rows.filter((r) => r.endedAt && r.elevationGainM == null);
      const withAltitude = pending.length
        ? new Set(
            (
              await ctx.db
                .selectDistinct({ driveId: locationPoints.driveId })
                .from(locationPoints)
                .where(
                  and(
                    inArray(locationPoints.driveId, pending.map((r) => r.id)),
                    isNotNull(locationPoints.altitude),
                  ),
                )
            ).map((r) => r.driveId),
          )
        : new Set<number | null>();
      for (const row of pending) {
        if (withAltitude.has(row.id)) {
          const elevation = await driveElevation(ctx.db, row.id);
          if (!elevation) continue;
          row.elevationGainM = elevation.gainM;
          row.elevationLossM = elevation.lossM;
          await ctx.db
            .update(drives)
            .set({ elevationGainM: elevation.gainM, elevationLossM: elevation.lossM })
            .where(eq(drives.id, row.id));
        }
      }
      const fallback = await latestCapacityKwh(ctx, request.params.id);
      const speeds = await maxSpeeds(ctx.db, rows.map((r) => r.id));
      const state = ctx.monitor.getState(request.params.id);
      const { spots } = await homeContext(ctx);
      return rows.map((row) => toDriveDto(row, fallback, speeds.get(row.id) ?? null, state, spots));
    },
  );

  app.get<{ Params: { driveId: string } }>(
    "/api/drives/:driveId",
    async (request, reply): Promise<DriveDetailDto | void> => {
      const driveId = Number(request.params.driveId);
      const rows = await ctx.db
        .select()
        .from(drives)
        .where(eq(drives.id, driveId))
        .limit(1);
      const drive = rows[0];
      if (!drive) return reply.code(404).send({ error: "Not found" });
      const points = await ctx.db
        .select()
        .from(locationPoints)
        .where(eq(locationPoints.driveId, driveId))
        .orderBy(locationPoints.ts)
        .limit(10_000);
      const fallback = await latestCapacityKwh(ctx, drive.vehicleId);
      const speed = (await maxSpeeds(ctx.db, [drive.id])).get(drive.id) ?? null;
      const state = ctx.monitor.getState(drive.vehicleId);
      if (!drive.endedAt) {
        // Elevation is stored when a drive ends; until then, from points so far.
        const elevation = await driveElevation(ctx.db, drive.id);
        drive.elevationGainM = elevation?.gainM ?? null;
        drive.elevationLossM = elevation?.lossM ?? null;
      }
      return {
        ...toDriveDto(drive, fallback, speed, state, (await homeContext(ctx)).spots),
        points: points.map(toLocationDto),
      };
    },
  );
}

/** Latest pack capacity seen for the vehicle (for drives without one). */
async function latestCapacityKwh(ctx: AppContext, vehicleId: string): Promise<number | null> {
  const rows = await ctx.db.execute<{ kwh: number | null }>(sql`
    SELECT (data->'batteryCapacity'->>'value')::float8 AS kwh
    FROM vehicle_state_snapshots
    WHERE vehicle_id = ${vehicleId} AND data ? 'batteryCapacity'
    ORDER BY ts DESC LIMIT 1
  `);
  return rows[0]?.kwh ?? null;
}

function toDriveDto(
  row: typeof drives.$inferSelect,
  fallbackCapacityKwh: number | null,
  maxSpeedKmh: number | null,
  current: VehicleState | undefined,
  homeSpots: readonly Spot[],
): DriveDto {
  // A drive in progress shows its figures so far, from the latest state.
  const live = row.endedAt == null && current ? current : null;
  const endBattery = live ? stateNumber(live, "batteryLevel") : row.endBattery;
  const distanceKm = live
    ? mileageDistanceKm(row.startMileageM, stateNumber(live, "vehicleMileage"))
    : row.distanceKm;
  return {
    id: row.id,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    startLat: row.startLat,
    startLon: row.startLon,
    endLat: row.endLat,
    endLon: row.endLon,
    distanceKm,
    startBattery: row.startBattery,
    endBattery,
    energyKwh: driveEnergyKwh(
      row.startBattery,
      endBattery,
      row.batteryCapacityKwh ?? fallbackCapacityKwh,
    ),
    elevationGainM: row.elevationGainM,
    elevationLossM: row.elevationLossM,
    startRangeKm: row.startRangeKm,
    endRangeKm: live ? stateNumber(live, "distanceToEmpty") : row.endRangeKm,
    maxSpeedKmh,
    driveMode: row.driveMode,
    destination:
      row.destinationLat != null && row.destinationLon != null
        ? { name: row.destinationName, lat: row.destinationLat, lon: row.destinationLon }
        : null,
    start: drivePlace(row.startLat, row.startLon, row.startPlace, row.startAddress, homeSpots),
    end: live ? null : drivePlace(row.endLat, row.endLon, row.endPlace, row.endAddress, homeSpots),
  };
}

/** "Home" near a home spot, else the looked-up address; null until known. */
export function drivePlace(
  lat: number | null,
  lon: number | null,
  place: string | null,
  address: string | null,
  homeSpots: readonly Spot[],
): DrivePlaceDto | null {
  if (nearbySpot(lat, lon, homeSpots)) return { label: "Home", address, isHome: true };
  return place ? { label: place, address, isHome: false } : null;
}

function toLocationDto(
  row: typeof locationPoints.$inferSelect,
): LocationPointDto {
  return {
    ts: row.ts.toISOString(),
    lat: row.lat,
    lon: row.lon,
    speedKmh: row.speedKmh,
    bearing: row.bearing,
    altitude: row.altitude,
  };
}
