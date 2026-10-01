import { and, desc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  DriveDetailDto,
  DriveDto,
  HistoryPoint,
  LocationPointDto,
} from "../api-types.js";
import type { AppContext } from "../context.js";
import { drives, locationPoints } from "../db/schema.js";
import { driveElevation } from "../services/drive-detector.js";
import { driveEnergyKwh } from "../services/drive-metrics.js";

const METRIC_COLUMNS: Record<string, string> = {
  battery: "battery_level",
  range: "range_km",
  mileage: "mileage_m",
  cabinTemp: "cabin_temp",
};

const historyQuerySchema = z.object({
  metric: z.enum(["battery", "range", "mileage", "cabinTemp"]).default("battery"),
  from: z.coerce.date().default(() => new Date(Date.now() - 7 * 86400_000)),
  to: z.coerce.date().default(() => new Date()),
  bucket: z.enum(["5m", "15m", "1h", "6h", "1d"]).default("1h"),
});

const BUCKET_INTERVALS: Record<string, string> = {
  "5m": "5 minutes",
  "15m": "15 minutes",
  "1h": "1 hour",
  "6h": "6 hours",
  "1d": "1 day",
};

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
    "/api/vehicles/:id/locations",
    async (request): Promise<LocationPointDto[]> => {
      const q = rangeQuerySchema.parse(request.query);
      const rows = await ctx.db
        .select()
        .from(locationPoints)
        .where(
          and(
            eq(locationPoints.vehicleId, request.params.id),
            gte(locationPoints.ts, q.from),
            lte(locationPoints.ts, q.to),
          ),
        )
        .orderBy(locationPoints.ts)
        .limit(5000);
      return rows.map(toLocationDto);
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
      return rows.map((row) => toDriveDto(row, fallback));
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
      return { ...toDriveDto(drive, fallback), points: points.map(toLocationDto) };
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
): DriveDto {
  return {
    id: row.id,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    startLat: row.startLat,
    startLon: row.startLon,
    endLat: row.endLat,
    endLon: row.endLon,
    distanceKm: row.distanceKm,
    startBattery: row.startBattery,
    endBattery: row.endBattery,
    energyKwh: driveEnergyKwh(
      row.startBattery,
      row.endBattery,
      row.batteryCapacityKwh ?? fallbackCapacityKwh,
    ),
    elevationGainM: row.elevationGainM,
    elevationLossM: row.elevationLossM,
  };
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
