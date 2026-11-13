import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ParkedNightDto, SchedulesDto, VehicleDto, VehicleInsightsDto } from '../api-types.js';
import type { AppContext } from '../context.js';
import { vehicles } from '../db/schema.js';
import { VEHICLE_VIEWS, type VehicleImageUrls, type VehicleView } from '../rivian/types.js';
import { isTeslaMateVehicle } from '../teslamate/ids.js';
import { NO_SCHEDULES } from '../teslamate/source.js';
import { placeContext } from './charging.js';
import { drivePlace } from './history.js';
import { sendRender } from './render-proxy.js';

/** The views a vehicle has a render for. */
const rendersOf = (images: VehicleImageUrls | null | undefined): VehicleView[] =>
  VEHICLE_VIEWS.filter((v) => images?.[v]);

const nightsQuery = z.object({
  nights: z.coerce.number().int().min(1).max(31).default(7),
  /** The calendar the reader's days are in; the recorder writes its nights in it. */
  tz: z.string().max(64).optional(),
});

export async function vehicleRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/api/vehicles', async (): Promise<VehicleDto[]> => {
    const rows = await ctx.db.select().from(vehicles);
    const fromMonitor = ctx.monitor.getVehicles();
    const images = new Map(rows.map((r) => [r.id, r.images]));
    const rivian = fromMonitor.length > 0 ? fromMonitor : rows;
    return [
      ...rivian.map((r) => ({
        id: r.id,
        vin: r.vin,
        name: r.name,
        make: r.make,
        model: r.model,
        modelYear: r.modelYear,
        renders: rendersOf(images.get(r.id)),
        source: 'rivian' as const,
      })),
      ...ctx.teslamate.getVehicles(),
    ];
  });

  app.get<{ Params: { id: string; view: string } }>(
    '/api/vehicles/:id/render/:view',
    async (request, reply) => {
      const view = VEHICLE_VIEWS.find((v) => v === request.params.view);
      const [row] = await ctx.db
        .select({ images: vehicles.images })
        .from(vehicles)
        .where(eq(vehicles.id, request.params.id));
      return sendRender(reply, view && row?.images?.[view]);
    },
  );

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
        ? ctx.teslamate.insights(request.params.id)
        : withSavedNames(ctx, await ctx.monitor.getInsights(request.params.id)),
  );

  // The nights of parked energy recorded so far, oldest first, for the week's
  // chart: one bar a night, filling in as nights pass.
  app.get<{ Params: { id: string } }>(
    '/api/vehicles/:id/parked-nights',
    async (request): Promise<ParkedNightDto[]> => {
      const { nights, tz } = nightsQuery.parse(request.query);
      if (isTeslaMateVehicle(request.params.id)) return [];
      return ctx.monitor.getParkedNights(request.params.id, nights, tz);
    },
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

/** Navigation's stops by the saved location they're in ("Home" near a wallbox), where they are. */
export async function withSavedNames(
  ctx: AppContext,
  insights: VehicleInsightsDto,
): Promise<VehicleInsightsDto> {
  const nav = insights.navigation;
  if (!nav) return insights;
  const places = await placeContext(ctx);
  const named = <T extends { name: string | null; lat: number; lon: number }>(stop: T): T => {
    const place = drivePlace(stop.lat, stop.lon, null, null, places);
    return place && !place.unnamed ? { ...stop, name: place.label } : stop;
  };
  return {
    ...insights,
    navigation: { ...nav, destination: named(nav.destination), stops: nav.stops.map(named) },
  };
}
