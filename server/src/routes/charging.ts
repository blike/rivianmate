import { and, between, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ChargingCurvePointDto, ChargingSessionDto, WallboxDto } from '../api-types.js';
import type { AppContext } from '../context.js';
import {
  type ChargingSettings,
  type SavedLocation,
  type Spot,
  estimateCost,
  sessionPlace,
  sessionRate,
  wallboxSpots,
} from '../services/locations.js';
import { loadLocations } from './locations.js';
import { getChargingSettings } from './settings.js';
import {
  chargingCurvePoints,
  chargingSessions,
  vehicleStateSnapshots,
  wallboxReadings,
  wallboxes,
} from '../db/schema.js';
import type { VehicleState } from '../rivian/types.js';
import { curveForDisplay, forecastForDisplay } from '../services/charging-curve.js';

/** Tolerance for Rivian's clock running ahead of the server's. */
const CLOCK_SLACK_MS = 60_000;
import { socReadingsBetween } from '../services/charging-time.js';
import { chargingWindow, loadChargeSpans } from '../services/charge-spans.js';

const patchSchema = z.object({
  cost: z.union([z.string(), z.number()]).nullable(),
});

export async function chargingRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get<{ Params: { id: string } }>(
    '/api/vehicles/:id/charging-sessions',
    async (request): Promise<ChargingSessionDto[]> => {
      const rows = await ctx.db
        .select()
        .from(chargingSessions)
        .where(eq(chargingSessions.vehicleId, request.params.id))
        .orderBy(desc(chargingSessions.startedAt))
        .limit(200);
      const places = await placeContext(ctx);
      const capacityKwh = await packCapacityKwh(ctx, request.params.id);
      const oldest = rows.at(-1);
      const spans = oldest
        ? await loadChargeSpans(ctx.db, request.params.id, oldest.startedAt, new Date())
        : [];
      return rows.map((row) =>
        toSessionDto(row, places, chargingWindow(spans, row.startedAt, row.endedAt), capacityKwh),
      );
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    '/api/charging-sessions/:sessionId/curve',
    async (request): Promise<ChargingCurvePointDto[]> => {
      const sessionId = Number(request.params.sessionId);
      const rows = await ctx.db
        .select()
        .from(chargingCurvePoints)
        .where(eq(chargingCurvePoints.sessionId, sessionId))
        .orderBy(chargingCurvePoints.ts)
        .limit(20_000);
      // Nothing recorded can be from the future; such rows were forecast.
      const latest = Date.now() + CLOCK_SLACK_MS;
      const curve = curveForDisplay(
        rows.filter((r) => r.source === 'forecast' || r.ts.getTime() <= latest),
      );
      const [session] = await ctx.db
        .select({
          endedAt: chargingSessions.endedAt,
          chargingSince: chargingSessions.chargingSince,
        })
        .from(chargingSessions)
        .where(eq(chargingSessions.id, sessionId));
      // Only while it's actually charging: stopped but still plugged in, or
      // unplugged, there's nothing left to forecast.
      const charging = session != null && session.endedAt == null && session.chargingSince != null;
      const forecast = forecastForDisplay(rows, curve, charging);
      if (curve.length > 0) {
        return [
          ...curve.map((r) => ({ ts: r.ts.toISOString(), powerKw: r.powerKw, soc: r.soc })),
          ...forecast.map((r) => ({
            ts: r.ts.toISOString(),
            powerKw: null,
            soc: r.soc,
            projected: true,
          })),
        ];
      }
      return socCurveFromState(ctx, sessionId);
    },
  );

  app.patch<{ Params: { sessionId: string } }>(
    '/api/charging-sessions/:sessionId',
    async (request, reply) => {
      const body = patchSchema.parse(request.body);
      const updated = await ctx.db
        .update(chargingSessions)
        .set({ cost: body.cost == null ? null : String(body.cost), costEdited: body.cost != null })
        .where(eq(chargingSessions.id, Number(request.params.sessionId)))
        .returning();
      if (!updated[0]) return reply.code(404).send({ error: 'Not found' });
      return toSessionDto(
        updated[0],
        await placeContext(ctx),
        null,
        await packCapacityKwh(ctx, updated[0].vehicleId),
      );
    },
  );

  app.get('/api/wallboxes', async (): Promise<WallboxDto[]> => {
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

export interface PlaceContext {
  settings: ChargingSettings;
  locations: SavedLocation[];
  wallboxes: Spot[];
}

export async function placeContext(ctx: AppContext): Promise<PlaceContext> {
  const boxes = await ctx.db
    .select({ latitude: wallboxes.latitude, longitude: wallboxes.longitude })
    .from(wallboxes);
  return {
    settings: await getChargingSettings(ctx),
    locations: await loadLocations(ctx),
    wallboxes: wallboxSpots(boxes),
  };
}

/** Snapshot rows are stamped on write, which can trail the readings inside. */
const SNAPSHOT_MARGIN_MS = 2 * 3600_000;

/**
 * Without a recorded power curve, battery level over the session from the
 * vehicle states RivianMate recorded (empty if it wasn't recording then).
 */
async function socCurveFromState(
  ctx: AppContext,
  sessionId: number,
): Promise<ChargingCurvePointDto[]> {
  const [session] = await ctx.db
    .select({
      vehicleId: chargingSessions.vehicleId,
      startedAt: chargingSessions.startedAt,
      endedAt: chargingSessions.endedAt,
    })
    .from(chargingSessions)
    .where(eq(chargingSessions.id, sessionId));
  if (!session) return [];
  const start = session.startedAt.getTime();
  const end = session.endedAt?.getTime() ?? Date.now();
  const states = await ctx.db
    .select({ data: vehicleStateSnapshots.data })
    .from(vehicleStateSnapshots)
    .where(
      and(
        eq(vehicleStateSnapshots.vehicleId, session.vehicleId),
        between(
          vehicleStateSnapshots.ts,
          new Date(start - SNAPSHOT_MARGIN_MS),
          new Date(end + SNAPSHOT_MARGIN_MS),
        ),
      ),
    )
    .orderBy(vehicleStateSnapshots.ts)
    .limit(5000);
  return socReadingsBetween(
    states.map((s) => s.data as VehicleState),
    start,
    end,
  ).map((r) => ({ ts: new Date(r.at).toISOString(), powerKw: null, soc: r.soc }));
}

/** The latest pack capacity recorded for the vehicle (kWh). */
async function packCapacityKwh(ctx: AppContext, vehicleId: string): Promise<number | null> {
  const rows = await ctx.db.execute<{ kwh: number | null }>(sql`
    SELECT (data->'batteryCapacity'->>'value')::float8 AS kwh
    FROM vehicle_state_snapshots
    WHERE vehicle_id = ${vehicleId} AND data ? 'batteryCapacity'
    ORDER BY ts DESC LIMIT 1
  `);
  return rows[0]?.kwh ?? null;
}

/**
 * Energy the battery gained over a session, from its battery levels and
 * the pack's capacity: what reached the pack, so a little under what the
 * charger delivered.
 */
export function socEnergyKwh(
  row: { startSoc: number | null; endSoc: number | null },
  capacityKwh: number | null,
): number | null {
  if (row.startSoc == null || row.endSoc == null || capacityKwh == null) return null;
  const kwh = ((row.endSoc - row.startSoc) / 100) * capacityKwh;
  return kwh > 0 ? kwh : null;
}

function toSessionDto(
  row: typeof chargingSessions.$inferSelect,
  places: PlaceContext,
  charging: { from: Date; to: Date } | null = null,
  capacityKwh: number | null = null,
): ChargingSessionDto {
  const place = sessionPlace(row, places.locations, places.wallboxes);
  const { location, isHome } = place;
  // Estimates use today's rates, so changing one reprices past estimates;
  // a cost recorded or entered for the session always wins. Until Rivian
  // reports the energy (often only after unplugging), it's estimated from
  // the battery gained.
  const estimatedEnergyKwh = row.energyKwh == null ? socEnergyKwh(row, capacityKwh) : null;
  const estimatedCost =
    row.cost == null
      ? estimateCost(row.energyKwh ?? estimatedEnergyKwh, sessionRate(place, places.locations))
      : null;
  return {
    id: row.id,
    vehicleId: row.vehicleId,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    chargerId: row.chargerId,
    chargerType: row.chargerType,
    startSoc: row.startSoc,
    endSoc: row.endSoc,
    chargingSeconds: row.chargingSeconds,
    chargingSince: row.chargingSince?.toISOString() ?? null,
    chargingStartedAt: charging?.from.toISOString() ?? null,
    chargingEndedAt: charging?.to.toISOString() ?? null,
    energyKwh: row.energyKwh,
    packKwh: row.packKwh,
    thermalKwh: row.thermalKwh,
    rangeAddedKm: row.rangeAddedKm,
    avgPowerKw: row.avgPowerKw,
    maxPowerKw: row.maxPowerKw,
    cost: row.cost,
    // Estimates are priced in the rates' currency.
    currency: row.currency ?? (estimatedCost != null ? places.settings.currency : null),
    lat: row.lat,
    lon: row.lon,
    source: row.source,
    vendor: row.vendor,
    city: row.city,
    isPublic: row.isPublic,
    isHome,
    location: location && { id: location.id, name: location.name, isHome: location.isHome },
    estimatedCost,
    estimatedEnergyKwh,
  };
}
