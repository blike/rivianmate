import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type {
  ParkedDayDto,
  PluggedInDto,
  SchedulesDto,
  VehicleDto,
  VehicleInsightsDto,
  VehicleSummaryDto,
} from '../api-types.js';
import type { AppContext } from '../context.js';
import { vehicles } from '../db/schema.js';
import { pluggedInAt } from '../services/charge-spans.js';
import { isTimeZone } from '../services/imports/time-zone.js';
import {
  type SummaryVehicleMeta,
  buildVehicleSummary,
  resolveSummaryUnits,
} from '../services/vehicle-summary.js';
import { VEHICLE_VIEWS, type VehicleImageUrls, type VehicleView } from '../rivian/types.js';
import { isTeslaMateVehicle } from '../teslamate/ids.js';
import { NO_SCHEDULES } from '../teslamate/source.js';
import { placeContext } from './charging.js';
import { drivePlace } from './history.js';
import { sendRender } from './render-proxy.js';
import { DEFAULT_UNITS, getUnitPreferences } from './settings.js';

/** The views a vehicle has a render for. */
const rendersOf = (images: VehicleImageUrls | null | undefined): VehicleView[] =>
  VEHICLE_VIEWS.filter((v) => images?.[v]);

const parkedDaysQuery = z.object({
  days: z.coerce.number().int().min(1).max(31).default(7),
  /** The calendar the reader's days are in; the server's own until one is named. */
  tz: z.string().max(64).optional(),
});

const summaryQuery = z.object({
  units: z.enum(['user', 'imperial', 'metric']).default('user'),
});

export async function vehicleRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/api/vehicles', { config: { apiKey: true } }, async (): Promise<VehicleDto[]> => {
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
    '/api/vehicles/:id/summary',
    { config: { apiKey: true } },
    async (request, reply): Promise<VehicleSummaryDto | void> => {
      const { units } = summaryQuery.parse(request.query);
      const id = request.params.id;
      const state = vehicleState(ctx, id);
      if (!state) return reply.code(404).send({ error: 'No state yet' });
      const meta = await vehicleMeta(ctx, id);
      const userUnits = units === 'user' ? await getUnitPreferences(ctx) : DEFAULT_UNITS;
      const prefs = resolveSummaryUnits(units, userUnits);
      const liveCharging = ctx.bus.latestChargingSession(id);
      return buildVehicleSummary(meta, state, prefs, liveCharging);
    },
  );

  // A session starts when it charges, so when it was plugged in comes from
  // the recorded charger status instead.
  app.get<{ Params: { id: string } }>(
    '/api/vehicles/:id/plugged-in',
    async (request): Promise<PluggedInDto> => {
      if (isTeslaMateVehicle(request.params.id)) return { pluggedInAt: null };
      const at = await pluggedInAt(ctx.db, request.params.id);
      return { pluggedInAt: at?.toISOString() ?? null };
    },
  );

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

  // The last full days of parked energy, oldest first, for the week's chart:
  // each day's last 24-hour window, read from the archive.
  app.get<{ Params: { id: string } }>(
    '/api/vehicles/:id/parked-days',
    async (request): Promise<ParkedDayDto[]> => {
      const { days, tz } = parkedDaysQuery.parse(request.query);
      if (isTeslaMateVehicle(request.params.id)) return [];
      const zone = tz && isTimeZone(tz) ? tz : Intl.DateTimeFormat().resolvedOptions().timeZone;
      return ctx.monitor.getParkedDays(request.params.id, days, zone);
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

async function vehicleMeta(ctx: AppContext, vehicleId: string): Promise<SummaryVehicleMeta> {
  if (isTeslaMateVehicle(vehicleId)) {
    const tm = ctx.teslamate.getVehicles().find((v) => v.id === vehicleId);
    return {
      id: vehicleId,
      vin: tm?.vin ?? '',
      name: tm?.name ?? null,
      make: tm?.make ?? null,
      model: tm?.model ?? null,
      modelYear: tm?.modelYear ?? null,
      source: 'teslamate',
    };
  }
  const monitored = ctx.monitor.getVehicles().find((v) => v.id === vehicleId);
  if (monitored) {
    return {
      id: monitored.id,
      vin: monitored.vin,
      name: monitored.name,
      make: monitored.make,
      model: monitored.model,
      modelYear: monitored.modelYear,
      source: 'rivian',
    };
  }
  const [row] = await ctx.db.select().from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1);
  return {
    id: vehicleId,
    vin: row?.vin ?? '',
    name: row?.name ?? null,
    make: row?.make ?? null,
    model: row?.model ?? null,
    modelYear: row?.modelYear ?? null,
    source: 'rivian',
  };
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
