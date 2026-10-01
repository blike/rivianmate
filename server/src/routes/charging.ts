import { desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  ChargingCurvePointDto,
  ChargingSessionDto,
  WallboxDto,
} from "../api-types.js";
import type { AppContext } from "../context.js";
import {
  chargingCurvePoints,
  chargingSessions,
  wallboxReadings,
  wallboxes,
} from "../db/schema.js";

const patchSchema = z.object({
  cost: z.union([z.string(), z.number()]).nullable(),
});

export async function chargingRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.get<{ Params: { id: string } }>(
    "/api/vehicles/:id/charging-sessions",
    async (request): Promise<ChargingSessionDto[]> => {
      const rows = await ctx.db
        .select()
        .from(chargingSessions)
        .where(eq(chargingSessions.vehicleId, request.params.id))
        .orderBy(desc(chargingSessions.startedAt))
        .limit(200);
      return rows.map(toSessionDto);
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    "/api/charging-sessions/:sessionId/curve",
    async (request): Promise<ChargingCurvePointDto[]> => {
      const rows = await ctx.db
        .select()
        .from(chargingCurvePoints)
        .where(eq(chargingCurvePoints.sessionId, Number(request.params.sessionId)))
        .orderBy(chargingCurvePoints.ts)
        .limit(5000);
      return rows.map((r) => ({ ts: r.ts.toISOString(), powerKw: r.powerKw, soc: r.soc }));
    },
  );

  app.patch<{ Params: { sessionId: string } }>(
    "/api/charging-sessions/:sessionId",
    async (request, reply) => {
      const body = patchSchema.parse(request.body);
      const updated = await ctx.db
        .update(chargingSessions)
        .set({ cost: body.cost == null ? null : String(body.cost) })
        .where(eq(chargingSessions.id, Number(request.params.sessionId)))
        .returning();
      if (!updated[0]) return reply.code(404).send({ error: "Not found" });
      return toSessionDto(updated[0]);
    },
  );

  app.get("/api/wallboxes", async (): Promise<WallboxDto[]> => {
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

function toSessionDto(
  row: typeof chargingSessions.$inferSelect,
): ChargingSessionDto {
  return {
    id: row.id,
    vehicleId: row.vehicleId,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    chargerId: row.chargerId,
    chargerType: row.chargerType,
    startSoc: row.startSoc,
    endSoc: row.endSoc,
    energyKwh: row.energyKwh,
    rangeAddedKm: row.rangeAddedKm,
    avgPowerKw: row.avgPowerKw,
    maxPowerKw: row.maxPowerKw,
    cost: row.cost,
    currency: row.currency,
    lat: row.lat,
    lon: row.lon,
  };
}
