/**
 * Integration tests against a real Postgres. Skipped unless
 * TEST_DATABASE_URL points at a disposable database (tables are truncated).
 *
 * These drive a decoded navigation frame through the monitor's own state path
 * into the location writer, so the pieces that were tested separately — the
 * decoder, `preferLegacy`, the writer — are proven to meet.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, runMigrations } from '../db/client.js';
import { drives, locationPoints, vehicles } from '../db/schema.js';
import { silentLogger } from '../logger.js';
import { b64, double, float, int, message } from '../testing/protobuf.js';
import { RVM_TRIP_PROGRESS, vehicleStateFromParallax } from '../rivian/parallax/index.js';
import type { VehicleState } from '../rivian/types.js';
import { driveElevation, maxSpeeds } from './drive-detector.js';
import { LiveBus } from './live-bus.js';
import type { TokenStore } from './token-store.js';
import { VehicleMonitor, type RivianConnection } from './vehicle-monitor.js';

const url = process.env.TEST_DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));

describe.skipIf(!url)('navigation fixes through the monitor', () => {
  let handle: ReturnType<typeof createDb>;
  let monitor: VehicleMonitor;

  /** A trip_progress frame carrying the vehicle's own fix, laid out as an R2 sends it. */
  const frame = (lat: number, lon: number, speedMps: number, bearing: number, fixMs: number) =>
    b64([
      ...double(4, 1_200),
      ...double(5, 90),
      ...message(6, [
        ...message(1, [...double(1, lat), ...double(2, lon)]),
        ...float(2, speedMps),
        ...float(3, bearing),
        ...int(5, fixMs),
      ]),
    ]);

  /** The delta the router hands the monitor for that frame. */
  const delta = (lat: number, lon: number, speedMps: number, bearing: number, at: number) =>
    vehicleStateFromParallax(
      RVM_TRIP_PROGRESS,
      frame(lat, lon, speedMps, bearing, at),
      new Date(at).toISOString(),
    )!;

  const handleDelta = (readings: VehicleState) =>
    (
      monitor as unknown as {
        handleDelta(id: string, d: object, source: 'parallax' | 'legacy'): Promise<void>;
      }
    ).handleDelta('v1', readings, 'parallax');

  const points = () => handle.db.select().from(locationPoints).orderBy(locationPoints.ts);

  beforeAll(async () => {
    await runMigrations(url!, join(here, '..', '..', 'drizzle'));
    handle = createDb(url!);
  });
  afterAll(async () => {
    await handle.sql.end();
  });
  beforeEach(async () => {
    await handle.sql`TRUNCATE vehicles RESTART IDENTITY CASCADE`;
    monitor = new VehicleMonitor(
      handle.db,
      {
        load: async () => ({ authState: 'ok', tokens: {} }),
        setAuthState: async () => {},
      } as unknown as TokenStore,
      new LiveBus(),
      () => ({}) as unknown as RivianConnection,
      silentLogger,
    );
    monitor.getVehicles().push({
      id: 'v1',
      vin: 'VIN1',
      name: null,
      make: null,
      model: null,
      modelYear: null,
      supportedFeatures: [],
    });
    await handle.db.insert(vehicles).values({ id: 'v1', vin: 'VIN1' });
  });

  it('stores the fix a navigation frame carries, decoded from the frame itself', async () => {
    const at = Date.now();
    await handleDelta(delta(40.4842, -88.9937, 12.5, 271.5, at));

    const [point] = await points();
    expect(point!.ts.toISOString()).toBe(new Date(at).toISOString());
    expect(point!.lat).toBeCloseTo(40.4842, 6);
    expect(point!.lon).toBeCloseTo(-88.9937, 6);
    expect(point!.speedKmh).toBeCloseTo(45, 5);
    expect(point!.bearing).toBeCloseTo(271.5, 3);
  });

  it("keeps a drive's max speed and elevation, which only the fixes carry", async () => {
    const [drive] = await handle.db
      .insert(drives)
      .values({ vehicleId: 'v1', startedAt: new Date(Date.now() - 60_000) })
      .returning();
    const at = (msAgo: number) => Date.now() - msAgo;
    const withHeight = (readings: VehicleState, altitude: number, stamp: number) => ({
      ...readings,
      gnssAltitude: { value: altitude, timeStamp: new Date(stamp).toISOString() },
    });

    await handleDelta(withHeight(delta(40.48, -88.99, 12.5, 271.5, at(10_000)), 300, at(10_000)));
    await handleDelta(withHeight(delta(40.4805, -88.99, 20, 271.5, at(5_000)), 320, at(5_000)));

    expect((await points()).map((p) => p.driveId)).toEqual([drive!.id, drive!.id]);
    expect(await maxSpeeds(handle.db, [drive!.id])).toEqual(new Map([[drive!.id, 72]]));
    expect(await driveElevation(handle.db, drive!.id)).toEqual({ gainM: 20, lossM: 0 });
  });

  it('leaves a car with legacy GPS of its own on its legacy track', async () => {
    // An R1: legacy reports a fix every few seconds, so the navigation fix must
    // not reach the writer at all — the stored track is what it was before this
    // change, from legacy, with its speed and height beside it.
    const at = (msAgo: number) => Date.now() - msAgo;
    const legacy = (msAgo: number, lat: number) => ({
      gnssLocation: {
        latitude: lat,
        longitude: -88.99,
        timeStamp: new Date(at(msAgo)).toISOString(),
      },
      gnssSpeed: { value: 10, timeStamp: new Date(at(msAgo)).toISOString() },
      gnssAltitude: { value: 300, timeStamp: new Date(at(msAgo)).toISOString() },
    });
    const handleLegacy = (readings: VehicleState) =>
      (
        monitor as unknown as {
          handleDelta(id: string, d: object, source: 'legacy'): Promise<void>;
        }
      ).handleDelta('v1', readings, 'legacy');

    await handleLegacy(legacy(20_000, 40.48));
    await handleLegacy(legacy(15_000, 40.4805));
    await handleLegacy(legacy(10_000, 40.481));
    // Now the car starts navigating: a fresh navigation fix arrives and is refused.
    await handleDelta(delta(40.49, -88.99, 20, 271.5, at(5_000)));

    const rows = await points();
    expect(rows.map((p) => p.lat)).toEqual([40.48, 40.4805, 40.481]);
    expect(rows.every((p) => p.speedKmh === 36 && p.altitude === 300)).toBe(true);
  });

  it('stores a navigation frame replayed long after the fact once, at its own time', async () => {
    const taken = Date.now() - 6 * 3600_000;
    await handleDelta(delta(40.5, -88.99, 12.5, 271.5, taken));
    await handleDelta(delta(40.5, -88.99, 12.5, 271.5, taken));
    expect((await points()).map((p) => p.ts.getTime())).toEqual([taken]);
  });
});
