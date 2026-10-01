import { and, asc, eq, gte, isNotNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { BatteryHealthDto, PhantomDrainDto } from "../api-types.js";
import type { AppContext } from "../context.js";
import { chargingSessions, vehicleStateSnapshots } from "../db/schema.js";
import { capacityEstimates, phantomDrain } from "../services/health.js";

const daysQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

export async function healthRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get<{ Params: { id: string } }>(
    "/api/vehicles/:id/health/phantom-drain",
    async (request): Promise<PhantomDrainDto> => {
      const { days } = daysQuery.parse(request.query);
      const since = new Date(Date.now() - days * 86_400_000);
      const rows = await ctx.db
        .select({
          ts: vehicleStateSnapshots.ts,
          batteryLevel: vehicleStateSnapshots.batteryLevel,
          mileageM: vehicleStateSnapshots.mileageM,
          chargerStatus: vehicleStateSnapshots.chargerStatus,
        })
        .from(vehicleStateSnapshots)
        .where(
          and(
            eq(vehicleStateSnapshots.vehicleId, request.params.id),
            gte(vehicleStateSnapshots.ts, since),
          ),
        )
        .orderBy(asc(vehicleStateSnapshots.ts));
      return phantomDrain(rows);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/vehicles/:id/health/battery",
    async (request): Promise<BatteryHealthDto> => {
      const sessions = await ctx.db
        .select({
          id: chargingSessions.id,
          startedAt: chargingSessions.startedAt,
          startSoc: chargingSessions.startSoc,
          endSoc: chargingSessions.endSoc,
          energyKwh: chargingSessions.energyKwh,
        })
        .from(chargingSessions)
        .where(
          and(
            eq(chargingSessions.vehicleId, request.params.id),
            isNotNull(chargingSessions.endedAt),
          ),
        )
        .orderBy(asc(chargingSessions.startedAt));

      const reported = await ctx.db.execute<{ day: string; kwh: number }>(sql`
        SELECT date_trunc('day', ts) AS day,
               MAX((data->'batteryCapacity'->>'value')::float8) AS kwh
        FROM vehicle_state_snapshots
        WHERE vehicle_id = ${request.params.id} AND data ? 'batteryCapacity'
        GROUP BY 1 ORDER BY 1
      `);
      const cellType = await ctx.db.execute<{ value: string | null }>(sql`
        SELECT data->'batteryCellType'->>'value' AS value
        FROM vehicle_state_snapshots
        WHERE vehicle_id = ${request.params.id} AND data ? 'batteryCellType'
        ORDER BY ts DESC LIMIT 1
      `);

      return {
        estimates: capacityEstimates(sessions),
        reported: reported.map((r) => ({ day: new Date(r.day).toISOString(), kwh: r.kwh })),
        cellType: cellType[0]?.value ?? null,
      };
    },
  );
}
