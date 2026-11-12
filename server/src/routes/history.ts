import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, or } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type {
  ChargeSpanDto,
  DriveCoverageDto,
  DriveDetailDto,
  DriveDto,
  DrivePlaceDto,
  DriverDto,
  HistoryMetric,
  HistoryPoint,
  LocationPointDto,
  StateSpanDto,
} from '../api-types.js';
import type { AppContext } from '../context.js';
import { drivers, drives, locationPoints } from '../db/schema.js';
import {
  driveElevation,
  maxSpeeds,
  mileageDistanceKm,
  movingSeconds,
} from '../services/drive-detector.js';
import { driverNames } from '../services/drivers.js';
import { MIN_DRIVE_KM, driveEnergyKwh } from '../services/drive-metrics.js';
import type { VehicleState } from '../rivian/types.js';
import { stateNumber } from '../services/state-utils.js';
import { nearbySpot } from '../services/locations.js';
import { type PlaceContext, placeContext } from './charging.js';
import { afterStart, listLimit, listWindowSchema } from './list-window.js';
import { loadChargeSpans } from '../services/charge-spans.js';
import { loadStateSpans } from '../services/state-spans.js';
import { thinTrack, trackBucketSeconds, trackToleranceM } from '../services/simplify-track.js';
import {
  type BandFields,
  bandSeries,
  bucketSeries,
  latestNumber,
  numericSeries,
} from '../services/state-history.js';
import { isTeslaMateVehicle } from '../teslamate/ids.js';

/** Which recorded field a history metric reads, where it reads only one. */
const METRIC_FIELDS = {
  battery: 'batteryLevel',
  range: 'distanceToEmpty',
  mileage: 'vehicleMileage',
} satisfies Record<Exclude<HistoryMetric, 'temp'>, string>;

/**
 * The pack's temperature, drawn as a band: its line from the field the vehicle
 * averages, its band from the two it reports its own extremes in. The cells run
 * a few degrees apart while the pack works, which the average on its own hides.
 */
const PACK_TEMPERATURE_FIELDS: BandFields = {
  avg: 'batteryTempAvg',
  min: 'batteryTempMin',
  max: 'batteryTempMax',
};

const historyQuerySchema = z.object({
  metric: z.enum(['battery', 'range', 'mileage', 'temp']).default('battery'),
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

/** A driver picked by hand; null for nobody. */
const driveDriverSchema = z.object({ driverId: z.number().int().nullable() });

const rangeQuerySchema = z.object({
  from: z.coerce.date().default(() => new Date(Date.now() - 86400_000)),
  to: z.coerce.date().default(() => new Date()),
});

export async function historyRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get<{ Params: { id: string } }>(
    '/api/vehicles/:id/history',
    async (request): Promise<HistoryPoint[]> => {
      const q = historyQuerySchema.parse(request.query);
      if (isTeslaMateVehicle(request.params.id)) {
        // TeslaMate records no pack temperature, so it has none to draw.
        if (q.metric === 'temp') return [];
        return ctx.teslamate.history(request.params.id, { ...q, metric: q.metric });
      }
      // Nothing is known past now; a value held then isn't carried into the future.
      const to = new Date(Math.min(q.to.getTime(), Date.now()));
      if (q.metric === 'temp') {
        const rows = await bandSeries(
          ctx.db,
          request.params.id,
          PACK_TEMPERATURE_FIELDS,
          q.from,
          to,
          BUCKET_MS[q.bucket] ?? null,
        );
        return rows.map((r) => ({
          bucket: new Date(r.at).toISOString(),
          avg: r.avg,
          min: r.min,
          max: r.max,
        }));
      }
      const { opening, changes } = await numericSeries(
        ctx.db,
        request.params.id,
        METRIC_FIELDS[q.metric],
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
      }>(locationRows(request.params.id, q.from, q.to));
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
      const query = ctx.db
        .select()
        .from(drives)
        .where(
          and(
            eq(drives.vehicleId, request.params.id),
            q.from ? gte(drives.startedAt, q.from) : undefined,
            q.to ? lte(drives.startedAt, q.to) : undefined,
            q.before ? lt(drives.startedAt, q.before) : undefined,
            q.after ? gte(drives.startedAt, afterStart(q.after)) : undefined,
            // A drive under way, or one with no distance, still shows.
            or(
              isNull(drives.endedAt),
              isNull(drives.distanceKm),
              gte(drives.distanceKm, MIN_DRIVE_KM),
            ),
          ),
        )
        // A page above is the oldest after it, turned round below.
        .orderBy(q.after ? asc(drives.startedAt) : desc(drives.startedAt))
        .$dynamic();
      const limit = listLimit(q);
      const rows = await (limit ? query.limit(limit) : query);
      return driveDtos(ctx, request.params.id, q.after ? rows.reverse() : rows);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/vehicles/:id/drivers',
    async (request): Promise<DriverDto[]> => {
      // TeslaMate's drives are read-only, so there is no one to pick.
      if (isTeslaMateVehicle(request.params.id)) return [];
      const names = await driverNames(ctx.db, request.params.id);
      return [...names].map(([id, name]) => ({ id, name }));
    },
  );

  // Kept as picked: the vehicle's profile never replaces it.
  app.put<{ Params: { driveId: string } }>(
    '/api/drives/:driveId/driver',
    async (request, reply) => {
      const { driverId } = driveDriverSchema.parse(request.body);
      const driveId = Number(request.params.driveId);
      if (!Number.isSafeInteger(driveId)) return reply.code(404).send({ error: 'Not found' });
      const [drive] = await ctx.db
        .select({ vehicleId: drives.vehicleId })
        .from(drives)
        .where(eq(drives.id, driveId));
      if (!drive) return reply.code(404).send({ error: 'Not found' });
      if (driverId != null) {
        const [driver] = await ctx.db
          .select({ id: drivers.id })
          .from(drivers)
          .where(and(eq(drivers.id, driverId), eq(drivers.vehicleId, drive.vehicleId)));
        if (!driver) return reply.code(400).send({ error: "Not one of this vehicle's drivers" });
      }
      await ctx.db
        .update(drives)
        .set({ driverId, driverSource: 'manual' })
        .where(eq(drives.id, driveId));
      return reply.code(204).send();
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

/** A vehicle's recorded drives as the API shows them. */
/**
 * A vehicle's location points over [from, to], in time order: each drive's
 * averaged into one per `trackBucketSeconds`, as TeslaMate's are, or every
 * point for a short window. A bucket's bearing is its first, since bearings
 * don't average across north.
 */
function locationRows(vehicleId: string, from: Date, to: Date) {
  const where = sql`vehicle_id = ${vehicleId}
    AND ts BETWEEN ${from.toISOString()}::timestamptz AND ${to.toISOString()}::timestamptz`;
  const bucketSeconds = trackBucketSeconds(from, to);
  if (bucketSeconds == null) {
    return sql`
      SELECT ts, lat, lon, speed_kmh, bearing, altitude, drive_id
      FROM location_points WHERE ${where}
      ORDER BY ts
    `;
  }
  return sql`
    SELECT MIN(ts) AS ts, AVG(lat) AS lat, AVG(lon) AS lon, AVG(speed_kmh) AS speed_kmh,
           (ARRAY_AGG(bearing ORDER BY ts))[1] AS bearing, AVG(altitude) AS altitude, drive_id
    FROM (
      SELECT *, date_bin(${`${bucketSeconds} seconds`}::interval, ts, TIMESTAMPTZ '2000-01-01') AS bucket
      FROM location_points WHERE ${where}
    ) p
    GROUP BY drive_id, bucket
    ORDER BY 1
  `;
}

export async function driveDtos(
  ctx: AppContext,
  vehicleId: string,
  rows: (typeof drives.$inferSelect)[],
): Promise<DriveDto[]> {
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
  const fallback = await latestCapacityKwh(ctx, vehicleId);
  const ids = rows.map((r) => r.id);
  const speeds = await maxSpeeds(ctx.db, ids);
  const moving = await movingSeconds(ctx.db, ids);
  const state = ctx.monitor.getState(vehicleId);
  const places = await placeContext(ctx);
  const names = await driverNames(ctx.db, vehicleId);
  return rows.map((row) =>
    toDriveDto(
      row,
      fallback,
      speeds.get(row.id) ?? null,
      moving.get(row.id) ?? null,
      state,
      places,
      names,
    ),
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
  // Every point, so a long drive's route runs the whole way; the chart thins them.
  const points = await ctx.db
    .select()
    .from(locationPoints)
    .where(eq(locationPoints.driveId, driveId))
    .orderBy(locationPoints.ts);
  const fallback = await latestCapacityKwh(ctx, drive.vehicleId);
  const speed = (await maxSpeeds(ctx.db, [drive.id])).get(drive.id) ?? null;
  const moving = (await movingSeconds(ctx.db, [drive.id])).get(drive.id) ?? null;
  const state = ctx.monitor.getState(drive.vehicleId);
  if (!drive.endedAt) {
    // Elevation is stored when a drive ends; until then, from points so far.
    const elevation = await driveElevation(ctx.db, drive.id);
    drive.elevationGainM = elevation?.gainM ?? null;
    drive.elevationLossM = elevation?.lossM ?? null;
  }
  return {
    ...toDriveDto(
      drive,
      fallback,
      speed,
      moving,
      state,
      await placeContext(ctx),
      await driverNames(ctx.db, drive.vehicleId),
    ),
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
  movingSeconds: number | null,
  current: VehicleState | undefined,
  places: PlaceContext,
  /** The vehicle's drivers' names, by id. */
  driverNames: ReadonlyMap<number, string>,
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
    movingSeconds,
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
    driver: driveDriver(row, driverNames),
  };
}

function driveDriver(
  row: typeof drives.$inferSelect,
  names: ReadonlyMap<number, string>,
): DriveDto['driver'] {
  const name = row.driverId == null ? undefined : names.get(row.driverId);
  if (name === undefined || row.driverSource == null || row.driverSource === 'none') return null;
  return { id: row.driverId!, name, source: row.driverSource };
}

/**
 * A saved location's name, "Home" near a wallbox, the name navigation gave a
 * place the vehicle arrived at, else the looked-up address; null until known.
 */
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
    return { label: location.name, address, isHome, locationId: location.id, unnamed: false };
  }
  if (nearbySpot(lat, lon, places.wallboxes)) {
    return { label: 'Home', address, isHome: true, locationId: null, unnamed: false };
  }
  // "Jumbo Rocks Campground" says more than the road it's on.
  const navigated = nearbySpot(lat, lon, places.navigated);
  if (navigated) {
    return {
      label: navigated.name,
      address: address ?? place,
      isHome: false,
      locationId: null,
      unnamed: false,
      navigated: true,
    };
  }
  if (place) return { label: place, address, isHome: false, locationId: null, unnamed: false };
  // With lookups off no address is coming, so say where rather than "Unknown".
  if (!places.addressLookups && lat != null && lon != null) {
    return {
      label: coordinatesLabel(lat, lon),
      address: null,
      isHome: false,
      locationId: null,
      unnamed: true,
    };
  }
  return null;
}

/**
 * "33.0714°N 117.2566°W": to about 11 m, and without a comma, which short
 * labels cut at.
 */
export function coordinatesLabel(lat: number, lon: number): string {
  const part = (v: number, pos: string, neg: string) =>
    `${Math.abs(v).toFixed(4)}°${v < 0 ? neg : pos}`;
  return `${part(lat, 'N', 'S')} ${part(lon, 'E', 'W')}`;
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
