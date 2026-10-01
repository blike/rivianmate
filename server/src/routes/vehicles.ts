import type { FastifyInstance } from "fastify";
import type { SchedulesDto, VehicleDto } from "../api-types.js";
import type { AppContext } from "../context.js";
import { vehicles } from "../db/schema.js";

export async function vehicleRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.get("/api/vehicles", async (): Promise<VehicleDto[]> => {
    const fromMonitor = ctx.monitor.getVehicles();
    if (fromMonitor.length > 0) return fromMonitor;
    const rows = await ctx.db.select().from(vehicles);
    return rows.map((r) => ({
      id: r.id,
      vin: r.vin,
      name: r.name,
      make: r.make,
      model: r.model,
      modelYear: r.modelYear,
    }));
  });

  app.get<{ Params: { id: string } }>(
    "/api/vehicles/:id/state",
    async (request, reply) => {
      const state = ctx.monitor.getState(request.params.id);
      if (!state) return reply.code(404).send({ error: "No state yet" });
      return state;
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/vehicles/:id/schedules",
    async (request): Promise<SchedulesDto> => ctx.monitor.getSchedules(request.params.id),
  );

  /** SSE stream of merged full-state updates + live charging session. */
  app.get<{ Params: { id: string } }>(
    "/api/vehicles/:id/live",
    async (request, reply) => {
      const vehicleId = request.params.id;
      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      reply.raw.write(":ok\n\n");

      const send = (event: string, data: unknown) => {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const initial = ctx.monitor.getState(vehicleId);
      if (initial) send("state", initial);
      // Always sent, so clients can tell "not charging" from "not loaded yet".
      send("charging", ctx.bus.latestChargingSession(vehicleId));

      const offState = ctx.bus.onState((id, state) => {
        if (id === vehicleId) send("state", state);
      });
      const offCharging = ctx.bus.onChargingSession((id, session) => {
        if (id === vehicleId) send("charging", session);
      });
      const keepalive = setInterval(() => reply.raw.write(":ka\n\n"), 25_000);

      request.raw.on("close", () => {
        offState();
        offCharging();
        clearInterval(keepalive);
      });
    },
  );
}
