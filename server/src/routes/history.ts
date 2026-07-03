import { and, desc, eq, gte, lte } from "drizzle-orm";
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
      return rows.map(toDriveDto);
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
      return { ...toDriveDto(drive), points: points.map(toLocationDto) };
    },
  );
}

function toDriveDto(row: typeof drives.$inferSelect): DriveDto {
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
  };
}
