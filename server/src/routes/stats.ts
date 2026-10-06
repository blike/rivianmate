import { and, desc, eq, gte, inArray, isNotNull, ne } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DcCurvesDto, StatDriveDto, StatsDto } from "../api-types.js";
import type { AppContext } from "../context.js";
import { chargingCurvePoints, chargingSessions, drives } from "../db/schema.js";
import { curveForDisplay } from "../services/charging-curve.js";
import { driveEnergyKwh } from "../services/drive-metrics.js";
import {
  type StatSession,
  chargeKind,
  chargingNetwork,
  chargingSummary,
  driveTotals,
  powerBySoc,
} from "../services/stats.js";
import { homeContext, toSessionDto } from "./charging.js";
import { validTimeZone } from "./health.js";
import { latestCapacityKwh } from "./history.js";

/** Without `days`, all time. */
const periodQuery = z.object({
  days: z.coerce.number().int().min(1).max(3650).optional(),
  tz: z.string().max(64).optional(),
});

/** The most recent DC sessions charted together. */
const DC_CURVE_SESSIONS = 60;

function sinceFor(days: number | undefined): Date | null {
  return days == null ? null : new Date(Date.now() - days * 86_400_000);
}

export async function statsRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get<{ Params: { id: string } }>(
    "/api/vehicles/:id/stats",
    async (request): Promise<StatsDto> => {
      const vehicleId = request.params.id;
      const { days, tz } = periodQuery.parse(request.query);
      const since = sinceFor(days);

      const driveRows = await ctx.db
        .select()
        .from(drives)
        .where(
          and(
            eq(drives.vehicleId, vehicleId),
            isNotNull(drives.endedAt),
            since ? gte(drives.startedAt, since) : undefined,
          ),
        )
        .orderBy(drives.startedAt);
      const fallbackKwh = await latestCapacityKwh(ctx, vehicleId);
      const statDrives = driveRows.map((d) => ({
        id: d.id,
        startedAt: d.startedAt,
        endedAt: d.endedAt,
        distanceKm: d.distanceKm,
        energyKwh: driveEnergyKwh(d.startBattery, d.endBattery, d.batteryCapacityKwh ?? fallbackKwh),
        driveMode: d.driveMode,
        maxSpeedKmh: null,
      }));
      const [speed] = await ctx.db.execute<{ max: number | null }>(sql`
        SELECT MAX(speed_kmh)::float8 AS max
        FROM location_points
        WHERE vehicle_id = ${vehicleId} AND drive_id IS NOT NULL
          ${since ? sql`AND ts >= ${since.toISOString()}::timestamptz` : sql``}
      `);
      const [odometer] = await ctx.db.execute<{ mileage_m: number | null }>(sql`
        SELECT mileage_m FROM vehicle_state_snapshots
        WHERE vehicle_id = ${vehicleId} AND mileage_m > 0
        ORDER BY ts DESC LIMIT 1
      `);

      const home = await homeContext(ctx);
      const sessionRows = await ctx.db
        .select()
        .from(chargingSessions)
        .where(
          and(
            eq(chargingSessions.vehicleId, vehicleId),
            since ? gte(chargingSessions.startedAt, since) : undefined,
          ),
        );
      const sessions: StatSession[] = sessionRows.map((row) => {
        const dto = toSessionDto(row, home);
        const cost = dto.cost ?? dto.estimatedCost;
        return {
          startedAt: row.startedAt,
          endedAt: row.endedAt,
          energyKwh: row.energyKwh,
          maxPowerKw: row.maxPowerKw,
          avgPowerKw: row.avgPowerKw,
          chargingSeconds: row.chargingSeconds,
          chargerType: row.chargerType,
          vendor: row.vendor,
          isHome: dto.isHome,
          cost: cost == null ? null : Number(cost),
          currency: dto.currency,
        };
      });

      const totals = driveTotals(statDrives);
      return {
        since: since?.toISOString() ?? null,
        odometerKm: odometer?.mileage_m != null ? odometer.mileage_m / 1000 : null,
        drives: statDrives.map(
          (d): StatDriveDto => ({
            id: d.id,
            startedAt: d.startedAt.toISOString(),
            durationS: Math.max(0, (d.endedAt!.getTime() - d.startedAt.getTime()) / 1000),
            distanceKm: d.distanceKm,
            energyKwh: d.energyKwh,
            driveMode: d.driveMode,
          }),
        ),
        driving: { ...totals, topSpeedKmh: speed?.max ?? null },
        charging: chargingSummary(sessions, validTimeZone(tz)),
      };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/vehicles/:id/stats/dc-curves",
    async (request): Promise<DcCurvesDto> => {
      const { days } = periodQuery.parse(request.query);
      const since = sinceFor(days);
      const home = await homeContext(ctx);
      // Only sessions with recorded power can have a curve.
      const rows = await ctx.db
        .select()
        .from(chargingSessions)
        .where(
          and(
            eq(chargingSessions.vehicleId, request.params.id),
            isNotNull(chargingSessions.endedAt),
            isNotNull(chargingSessions.maxPowerKw),
            since ? gte(chargingSessions.startedAt, since) : undefined,
          ),
        )
        .orderBy(desc(chargingSessions.startedAt));
      const dc = rows
        .map((row) => ({ row, dto: toSessionDto(row, home) }))
        .filter(({ row, dto }) => chargeKind({ ...row, isHome: dto.isHome, cost: null }) === "dc")
        .slice(0, DC_CURVE_SESSIONS);
      if (dc.length === 0) return { sessions: [], points: [] };

      const curveRows = await ctx.db
        .select()
        .from(chargingCurvePoints)
        .where(
          and(
            inArray(chargingCurvePoints.sessionId, dc.map(({ row }) => row.id)),
            ne(chargingCurvePoints.source, "forecast"),
          ),
        );
      const bySession = new Map<number, typeof curveRows>();
      for (const point of curveRows) {
        const list = bySession.get(point.sessionId) ?? [];
        list.push(point);
        bySession.set(point.sessionId, list);
      }

      const result: DcCurvesDto = { sessions: [], points: [] };
      for (const { row, dto } of dc.reverse()) {
        const curve = powerBySoc(curveForDisplay(bySession.get(row.id) ?? []));
        if (curve.length < 2) continue;
        result.sessions.push({
          id: row.id,
          startedAt: row.startedAt.toISOString(),
          network: chargingNetwork({ isHome: dto.isHome, chargerType: row.chargerType, vendor: row.vendor }),
          maxPowerKw: row.maxPowerKw,
        });
        for (const p of curve) result.points.push({ sessionId: row.id, ...p });
      }
      return result;
    },
  );
}
