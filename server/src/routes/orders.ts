import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { OrderJourneyDto, OrdersDto } from '../api-types.js';
import type { AppContext } from '../context.js';
import { vehicles } from '../db/schema.js';
import { VEHICLE_VIEWS, type VehicleImageUrls } from '../rivian/types.js';
import { ORDER_REFRESH_MS, type OrderJourney } from '../services/order-tracker.js';
import { sendRender } from './render-proxy.js';

export async function orderRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/api/orders', async (): Promise<OrdersDto> => {
    const journeys = ctx.monitor.getJourneys();
    const images = await vehicleImages(ctx, journeys);
    return {
      journeys: journeys.map((j) => toDto(j, images)),
      checkedAt: ctx.monitor.journeysChecked?.toISOString() ?? null,
      refreshMinutes: ORDER_REFRESH_MS / 60_000,
    };
  });

  app.get<{ Params: { orderId: string; view: string } }>(
    '/api/orders/:orderId/render/:view',
    async (request, reply) => {
      const view = VEHICLE_VIEWS.find((v) => v === request.params.view);
      const journey = ctx.monitor
        .getJourneys()
        .find((j) => j.snapshot.id === request.params.orderId);
      if (!view || !journey) return sendRender(reply, null);
      const images = await vehicleImages(ctx, [journey]);
      return sendRender(reply, rendersOf(journey, images)[view]);
    },
  );
}

/** The order's own render where Rivian has one, the vehicle's otherwise. */
function rendersOf(
  journey: OrderJourney,
  images: Map<string, VehicleImageUrls | null>,
): VehicleImageUrls {
  const vehicle = journey.snapshot.vehicleId ? images.get(journey.snapshot.vehicleId) : null;
  return { ...vehicle, ...journey.renders };
}

async function vehicleImages(
  ctx: AppContext,
  journeys: OrderJourney[],
): Promise<Map<string, VehicleImageUrls | null>> {
  const ids = journeys.map((j) => j.snapshot.vehicleId).filter((id): id is string => id != null);
  if (ids.length === 0) return new Map();
  const rows = await ctx.db
    .select({ id: vehicles.id, images: vehicles.images })
    .from(vehicles)
    .where(ids.length === 1 ? eq(vehicles.id, ids[0]!) : inArray(vehicles.id, ids));
  return new Map(rows.map((r) => [r.id, r.images]));
}

function toDto(j: OrderJourney, images: Map<string, VehicleImageUrls | null>): OrderJourneyDto {
  const renders = rendersOf(j, images);
  return {
    orderId: j.snapshot.id,
    delivered: j.delivered,
    vehicleId: j.snapshot.vehicleId,
    state: j.snapshot.state,
    fulfillmentSummaryStatus: j.snapshot.fulfillmentSummaryStatus,
    detail: j.detail,
    delivery: j.delivery,
    renders: VEHICLE_VIEWS.filter((v) => renders[v]),
  };
}
