import type { FastifyInstance } from 'fastify';
import type { SchedulesDto, VehicleDto, VehicleInsightsDto } from '../api-types.js';
import type { AppContext } from '../context.js';
import { vehicles } from '../db/schema.js';
import { isTeslaMateVehicle } from '../teslamate/ids.js';
import { EMPTY_INSIGHTS, NO_SCHEDULES } from '../teslamate/source.js';

export async function vehicleRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/api/vehicles', async (): Promise<VehicleDto[]> => {
    const fromMonitor = ctx.monitor.getVehicles();
    const rivian = fromMonitor.length > 0 ? fromMonitor : await ctx.db.select().from(vehicles);
    return [
      ...rivian.map((r) => ({
        id: r.id,
        vin: r.vin,
        name: r.name,
        make: r.make,
        model: r.model,
        modelYear: r.modelYear,
        source: 'rivian' as const,
      })),
      ...ctx.teslamate.getVehicles(),
    ];
  });

  app.get<{ Params: { id: string } }>('/api/vehicles/:id/state', async (request, reply) => {
    const state = vehicleState(ctx, request.params.id);
    if (!state) return reply.code(404).send({ error: 'No state yet' });
    return state;
  });

  app.get<{ Params: { id: string } }>(
    '/api/vehicles/:id/schedules',
    async (request): Promise<SchedulesDto> =>
      isTeslaMateVehicle(request.params.id)
        ? NO_SCHEDULES
        : ctx.monitor.getSchedules(request.params.id),
  );

  app.get<{ Params: { id: string } }>(
    '/api/vehicles/:id/insights',
    async (request): Promise<VehicleInsightsDto> =>
      isTeslaMateVehicle(request.params.id)
        ? EMPTY_INSIGHTS
        : ctx.monitor.getInsights(request.params.id),
  );

  /** SSE stream of merged full-state updates + live charging session. */
  app.get<{ Params: { id: string } }>('/api/vehicles/:id/live', async (request, reply) => {
    const vehicleId = request.params.id;
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(':ok\n\n');

    const send = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const initial = vehicleState(ctx, vehicleId);
    if (initial) send('state', initial);
    // Always sent, so clients can tell "not charging" from "not loaded yet".
    send('charging', ctx.bus.latestChargingSession(vehicleId));

    const offState = ctx.bus.onState((id, state) => {
      if (id === vehicleId) send('state', state);
    });
    const offCharging = ctx.bus.onChargingSession((id, session) => {
      if (id === vehicleId) send('charging', session);
    });
    const keepalive = setInterval(() => reply.raw.write(':ka\n\n'), 25_000);

    request.raw.on('close', () => {
      offState();
      offCharging();
      clearInterval(keepalive);
    });
  });
}

/** Latest merged state, from TeslaMate or the Rivian monitor. */
export function vehicleState(ctx: AppContext, vehicleId: string) {
  return isTeslaMateVehicle(vehicleId)
    ? ctx.teslamate.getState(vehicleId)
    : ctx.monitor.getState(vehicleId);
}
