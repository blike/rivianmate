import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { SchedulesDto, VehicleDto, VehicleInsightsDto } from '../api-types.js';
import type { AppContext } from '../context.js';
import { vehicles } from '../db/schema.js';
import { VEHICLE_VIEWS, type VehicleImageUrls, type VehicleView } from '../rivian/types.js';

/** The views a vehicle has a render for. */
const rendersOf = (images: VehicleImageUrls | null | undefined): VehicleView[] =>
  VEHICLE_VIEWS.filter((v) => images?.[v]);

export async function vehicleRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/api/vehicles', async (): Promise<VehicleDto[]> => {
    const rows = await ctx.db.select().from(vehicles);
    const fromMonitor = ctx.monitor.getVehicles();
    if (fromMonitor.length > 0) {
      const images = new Map(rows.map((r) => [r.id, r.images]));
      return fromMonitor.map((v) => ({ ...v, renders: rendersOf(images.get(v.id)) }));
    }
    return rows.map((r) => ({
      id: r.id,
      vin: r.vin,
      name: r.name,
      make: r.make,
      model: r.model,
      modelYear: r.modelYear,
      renders: rendersOf(r.images),
    }));
  });

  // Rivian's render URLs carry a token, so the server fetches them and keeps
  // each one, keyed by its URL, until discovery stores a new one.
  const renderCache = new Map<string, { type: string; body: Buffer }>();
  app.get<{ Params: { id: string; view: string } }>(
    '/api/vehicles/:id/render/:view',
    async (request, reply) => {
      const view = VEHICLE_VIEWS.find((v) => v === request.params.view);
      const [row] = await ctx.db
        .select({ images: vehicles.images })
        .from(vehicles)
        .where(eq(vehicles.id, request.params.id));
      const url = view && row?.images?.[view];
      if (!url) return reply.code(404).send({ error: 'No render' });

      let render = renderCache.get(url);
      if (!render) {
        const res = await fetch(url);
        if (!res.ok) return reply.code(502).send({ error: 'Render unavailable' });
        render = {
          type: res.headers.get('content-type') ?? 'image/png',
          body: Buffer.from(await res.arrayBuffer()),
        };
        renderCache.set(url, render);
      }
      return reply
        .header('Content-Type', render.type)
        .header('Cache-Control', 'private, max-age=86400')
        .send(render.body);
    },
  );

  app.get<{ Params: { id: string } }>('/api/vehicles/:id/state', async (request, reply) => {
    const state = ctx.monitor.getState(request.params.id);
    if (!state) return reply.code(404).send({ error: 'No state yet' });
    return state;
  });

  app.get<{ Params: { id: string } }>(
    '/api/vehicles/:id/schedules',
    async (request): Promise<SchedulesDto> => ctx.monitor.getSchedules(request.params.id),
  );

  app.get<{ Params: { id: string } }>(
    '/api/vehicles/:id/insights',
    async (request): Promise<VehicleInsightsDto> => ctx.monitor.getInsights(request.params.id),
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

    const initial = ctx.monitor.getState(vehicleId);
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
