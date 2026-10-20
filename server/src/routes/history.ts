import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type {
  ChargeSpanDto,
  DriveCoverageDto,
  DriveDetailDto,
  DriveDto,
  DrivePlaceDto,
  HistoryPoint,
  LocationPointDto,
  StateSpanDto,
} from '../api-types.js';
import type { AppContext } from '../context.js';
import { drives, locationPoints } from '../db/schema.js';
import { driveElevation, maxSpeeds, mileageDistanceKm } from '../services/drive-detector.js';
import { MIN_DRIVE_KM, driveEnergyKwh } from '../services/drive-metrics.js';
import type { VehicleState } from '../rivian/types.js';
import { stateNumber } from '../services/state-utils.js';
import { nearbySpot } from '../services/locations.js';
import { type PlaceContext, placeContext } from './charging.js';
import { listLimit, listWindowSchema } from './list-window.js';
import { loadChargeSpans } from '../services/charge-spans.js';
import { loadStateSpans } from '../services/state-spans.js';
import { thinTrack, trackToleranceM } from '../services/simplify-track.js';
import { bucketSeries, latestNumber, numericSeries } from '../services/state-history.js';
import { isTeslaMateVehicle } from '../teslamate/ids.js';

const METRIC_FIELDS: Record<string, string> = {
  battery: 'batteryLevel',
  range: 'distanceToEmpty',
  mileage: 'vehicleMileage',
};

const historyQuerySchema = z.object({
  metric: z.enum(['battery', 'range', 'mileage']).default('battery'),
  from: z.coerce.date().default(() => new Date(Date.now() - 7 * 86400_000)),
  to: z.coerce.date().default(() => new Date()),
  /** "raw": every recorded change, unaveraged. */
  bucket: z.enum(['raw', '5m', '15m', '1h', '6h', '1d']).default('1h'),
});

const BUCKET_MS: Record<string, number> = {
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 3600_000,
  '6h': 6 * 3600_000,
  '1d': 86400_000,
};

const rangeQuerySchema = z.object({
  from: z.coerce.date().default(() => new Date(Date.now() - 86400_000)),
  to: z.coerce.date().default(() => new Date()),
});

export async function historyRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get<{ Params: { id: string } }>(
    '/api/vehicles/:id/history',
    async (request): Promise<HistoryPoint[]> => {
      const q = historyQuerySchema.parse(request.query);
      if (isTeslaMateVehicle(request.params.id)) return ctx.teslamate.history(request.params.id, q);
      // Nothing is known past now; a value held then isn't carried into the future.
      const to = new Date(Math.min(q.to.getTime(), Date.now()));
      const { opening, changes } = await numericSeries(
        ctx.db,
        request.params.id,
        METRIC_FIELDS[q.metric]!,
        q.from,
        to,
      );
      if (q.bucket === 'raw') {
        // The value held as the range opens, then each change.
        const points = opening ? [{ ...opening, at: q.from.getTime() }, ...changes] : changes;
        return points.map((p) => ({
          bucket: new Date(p.at).toISOString(),
          avg: p.value,
          min: p.value,
          max: p.value,
        }));
      }
      return bucketSeries(
        opening,
        changes,
        q.from.getTime(),
        to.getTime(),
        BUCKET_MS[q.bucket]!,
      ).map((b) => ({
        bucket: new Date(b.bucket).toISOString(),
        avg: b.avg,
        min: b.min,
        max: b.max,
      }));
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/vehicles/:id/charge-spans',
    async (request): Promise<ChargeSpanDto[]> => {
      const q = rangeQuerySchema.parse(request.query);
      if (isTeslaMateVehicle(request.params.id)) {
        return ctx.teslamate.chargeSpans(request.params.id, q.from, q.to);
      }
      const spans = await loadChargeSpans(ctx.db, request.params.id, q.from, q.to);
      return spans.map((s) => ({
        kind: s.kind,
        from: s.from.toISOString(),
        to: s.to.toISOString(),
      }));
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/vehicles/:id/state-spans',
    async (request): Promise<StateSpanDto[]> => {
      const q = rangeQuerySchema.parse(request.query);
      if (isTeslaMateVehicle(request.params.id)) {
        return ctx.teslamate.stateSpans(request.params.id, q.from, q.to);
      }
      const spans = await loadStateSpans(ctx.db, request.params.id, q.from, q.to);
      return spans.map((s) => ({
        state: s.state,
        from: s.from.toISOString(),
        to: s.to.toISOString(),
      }));
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/vehicles/:id/locations',
    async (request): Promise<LocationPointDto[]> => {
      const q = rangeQuerySchema.parse(request.query);
      if (isTeslaMateVehicle(request.params.id)) {
        return ctx.teslamate.locations(request.params.id, q.from, q.to);
      }
      const rows = await ctx.db.execute<{
        ts: string;
        lat: number;
        lon: number;
        speed_kmh: number | null;
        bearing: number | null;
        altitude: number | null;
        drive_id: number | null;
      }>(sql`
        SELECT ts, lat, lon, speed_kmh, bearing, altitude, drive_id
        FROM location_points
        WHERE vehicle_id = ${request.params.id}
          AND ts BETWEEN ${q.from.toISOString()}::timestamptz AND ${q.to.toISOString()}::timestamptz
        ORDER BY ts
      `);
      const kept = thinTrack(rows, (r) => r.drive_id, trackToleranceM(q.from, q.to));
      return kept.map((r) => ({
        ts: new Date(r.ts).toISOString(),
        lat: r.lat,
        lon: r.lon,
        speedKmh: r.speed_kmh,
        bearing: r.bearing,
        altitude: r.altitude,
        driveId: r.drive_id,
      }));
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/vehicles/:id/drive-coverage',
    async (request): Promise<DriveCoverageDto> => {
      if (isTeslaMateVehicle(request.params.id)) {
        return ctx.teslamate.driveCoverage(request.params.id);
      }
      const [first] = await ctx.db
        .select({ startedAt: drives.startedAt })
        .from(drives)
        .where(eq(drives.vehicleId, request.params.id))
        .orderBy(asc(drives.startedAt))
        .limit(1);
      return { since: first ? first.startedAt.toISOString() : null };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/vehicles/:id/drives',
    async (request): Promise<DriveDto[]> => {
      const q = listWindowSchema.parse(request.query);
      if (isTeslaMateVehicle(request.params.id)) {
        return ctx.teslamate.drives(request.params.id, await placeContext(ctx), {
          ...q,
          limit: listLimit(q),
        });
      }
      const rows = await ctx.db
        .select()
        .from(drives)
        .where(
          and(
            eq(drives.vehicleId, request.params.id),
            q.from ? gte(drives.startedAt, q.from) : undefined,
            q.to ? lte(drives.startedAt, q.to) : undefined,
            // A drive under way, or one with no distance, still shows.
            or(
              isNull(drives.endedAt),
              isNull(drives.distanceKm),
              gte(drives.distanceKm, MIN_DRIVE_KM),
            ),
          ),
        )
        .orderBy(desc(drives.startedAt))
        .limit(listLimit(q));
      // Drives recorded before elevation tracking: compute once and keep.
      // Only drives that actually have altitude readings are candidates, so
      // drives without any don't cost a query on every listing.
      const pending = rows.filter((r) => r.endedAt && r.elevationGainM == null);
      const withAltitude = pending.length
        ? new Set(
            (
              await ctx.db
                .selectDistinct({ driveId: locationPoints.driveId })
                .from(locationPoints)
                .where(
                  and(
                    inArray(
                      locationPoints.driveId,
                      pending.map((r) => r.id),
                    ),
                    isNotNull(locationPoints.altitude),
                  ),
                )
            ).map((r) => r.driveId),
          )
        : new Set<number | null>();
      for (const row of pending) {
        if (withAltitude.has(row.id)) {
          const elevation = await driveElevation(ctx.db, row.id);
          if (!elevation) continue;
          row.elevationGainM = elevation.gainM;
          row.elevationLossM = elevation.lossM;
          await ctx.db
            .update(drives)
            .set({ elevationGainM: elevation.gainM, elevationLossM: elevation.lossM })
            .where(eq(drives.id, row.id));
        }
      }
      const fallback = await latestCapacityKwh(ctx, request.params.id);
      const speeds = await maxSpeeds(
        ctx.db,
        rows.map((r) => r.id),
      );
      const state = ctx.monitor.getState(request.params.id);
      const places = await placeContext(ctx);
      return rows.map((row) =>
        toDriveDto(row, fallback, speeds.get(row.id) ?? null, state, places),
      );
    },
  );

  app.get<{ Params: { driveId: string } }>(
    '/api/drives/:driveId',
    async (request, reply): Promise<DriveDetailDto | void> => {
      const detail = await rivianDriveDetail(ctx, Number(request.params.driveId));
      if (!detail) return reply.code(404).send({ error: 'Not found' });
      return detail;
    },
  );

  app.get<{ Params: { id: string; driveId: string } }>(
    '/api/vehicles/:id/drives/:driveId',
    async (request, reply): Promise<DriveDetailDto | void> => {
      const { id } = request.params;
      const driveId = Number(request.params.driveId);
      const detail = isTeslaMateVehicle(id)
        ? await ctx.teslamate.drive(id, driveId, await placeContext(ctx))
        : await rivianDriveDetail(ctx, driveId, id);
      if (!detail) return reply.code(404).send({ error: 'Not found' });
      return detail;
    },
  );
}

/** A recorded drive with its route; null if missing or another vehicle's. */
async function rivianDriveDetail(
  ctx: AppContext,
  driveId: number,
  vehicleId?: string,
): Promise<DriveDetailDto | null> {
  if (!Number.isSafeInteger(driveId)) return null;
  const rows = await ctx.db.select().from(drives).where(eq(drives.id, driveId)).limit(1);
  const drive = rows[0];
  if (!drive || (vehicleId != null && drive.vehicleId !== vehicleId)) return null;
  const points = await ctx.db
    .select()
    .from(locationPoints)
    .where(eq(locationPoints.driveId, driveId))
    .orderBy(locationPoints.ts)
    .limit(10_000);
  const fallback = await latestCapacityKwh(ctx, drive.vehicleId);
  const speed = (await maxSpeeds(ctx.db, [drive.id])).get(drive.id) ?? null;
  const state = ctx.monitor.getState(drive.vehicleId);
  if (!drive.endedAt) {
    // Elevation is stored when a drive ends; until then, from points so far.
    const elevation = await driveElevation(ctx.db, drive.id);
    drive.elevationGainM = elevation?.gainM ?? null;
    drive.elevationLossM = elevation?.lossM ?? null;
  }
  return {
    ...toDriveDto(drive, fallback, speed, state, await placeContext(ctx)),
    points: points.map(toLocationDto),
  };
}

/** Latest pack capacity seen for the vehicle (for drives without one). */
function latestCapacityKwh(ctx: AppContext, vehicleId: string): Promise<number | null> {
  return latestNumber(ctx.db, vehicleId, 'batteryCapacity');
}

function toDriveDto(
  row: typeof drives.$inferSelect,
  fallbackCapacityKwh: number | null,
  maxSpeedKmh: number | null,
  current: VehicleState | undefined,
  places: PlaceContext,
): DriveDto {
  // A drive in progress shows its figures so far, from the latest state.
  const live = row.endedAt == null && current ? current : null;
  const endBattery = live ? stateNumber(live, 'batteryLevel') : row.endBattery;
  const distanceKm = live
    ? mileageDistanceKm(row.startMileageM, stateNumber(live, 'vehicleMileage'))
    : row.distanceKm;
  return {
    id: row.id,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    startLat: row.startLat,
    startLon: row.startLon,
    endLat: row.endLat,
    endLon: row.endLon,
    distanceKm,
    startBattery: row.startBattery,
    endBattery,
    energyKwh: driveEnergyKwh(
      row.startBattery,
      endBattery,
      row.batteryCapacityKwh ?? fallbackCapacityKwh,
    ),
    elevationGainM: row.elevationGainM,
    elevationLossM: row.elevationLossM,
    startRangeKm: row.startRangeKm,
    endRangeKm: live ? stateNumber(live, 'distanceToEmpty') : row.endRangeKm,
    maxSpeedKmh,
    outsideTempC: row.avgOutsideTempC,
    weather:
      row.minOutsideTempC != null && row.maxOutsideTempC != null
        ? {
            minC: row.minOutsideTempC,
            maxC: row.maxOutsideTempC,
            weatherCode: row.weatherCode,
            windKmh: row.windKmh,
            windFromDeg: row.windFromDeg,
          }
        : null,
    driveMode: row.driveMode,
    destination:
      row.destinationLat != null && row.destinationLon != null
        ? { name: row.destinationName, lat: row.destinationLat, lon: row.destinationLon }
        : null,
    start: drivePlace(row.startLat, row.startLon, row.startPlace, row.startAddress, places),
    end: live ? null : drivePlace(row.endLat, row.endLon, row.endPlace, row.endAddress, places),
  };
}

/** A saved location's name, "Home" near a wallbox, else the looked-up address; null until known. */
export function drivePlace(
  lat: number | null,
  lon: number | null,
  place: string | null,
  address: string | null,
  places: PlaceContext,
): DrivePlaceDto | null {
  const location = nearbySpot(lat, lon, places.locations);
  if (location) {
    const isHome = location.isHome || nearbySpot(lat, lon, places.wallboxes) !== null;
    return { label: location.name, address, isHome, locationId: location.id };
  }
  if (nearbySpot(lat, lon, places.wallboxes)) {
    return { label: 'Home', address, isHome: true, locationId: null };
  }
  return place ? { label: place, address, isHome: false, locationId: null } : null;
}

function toLocationDto(row: typeof locationPoints.$inferSelect): LocationPointDto {
  return {
    ts: row.ts.toISOString(),
    lat: row.lat,
    lon: row.lon,
    speedKmh: row.speedKmh,
    bearing: row.bearing,
    altitude: row.altitude,
  };
}
