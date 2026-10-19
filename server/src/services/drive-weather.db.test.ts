/**
 * Integration tests against a real Postgres. Skipped unless
 * TEST_DATABASE_URL points at a disposable database (tables are truncated).
 */
import { eq } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, runMigrations } from '../db/client.js';
import { drives, locationPoints, vehicles } from '../db/schema.js';
import { DriveWeather, type TemperatureLookup } from './drive-weather.js';

const url = process.env.TEST_DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));

const START = Date.parse('2026-10-01T15:00:00Z');
const at = (minutes: number) => new Date(START + minutes * 60_000);

/**
 * 10° at the start, rising a degree every 10 minutes, overcast with a 10 km/h
 * west wind; records each request's points.
 */
function fakeLookup(requests: number[]): TemperatureLookup {
  return async (points, from, to) => {
    requests.push(points.length);
    const times: number[] = [];
    for (let t = from.getTime() - 900_000; t <= to.getTime() + 900_000; t += 900_000) {
      times.push(t);
    }
    return points.map(() => ({
      times,
      tempsC: times.map((t) => 10 + (t - START) / 600_000),
      windKmh: times.map(() => 10),
      windDirDeg: times.map(() => 270),
      codes: times.map(() => 3),
    }));
  };
}

describe.skipIf(!url)('DriveWeather with Postgres', () => {
  let handle: ReturnType<typeof createDb>;

  /** A drive with a GPS point every minute for `minutes`, from minute `from`. */
  const drive = async (minutes: number, ended = true, distanceKm = 10, from = 0) => {
    const [row] = await handle.db
      .insert(drives)
      .values({
        vehicleId: 'v1',
        startedAt: at(from),
        endedAt: ended ? at(from + minutes) : null,
        startLat: 40,
        startLon: -89,
        endLat: 40.1,
        endLon: -89,
        distanceKm,
      })
      .returning();
    await points(row!.id, from, from + minutes);
    return row!.id;
  };
  const points = (driveId: number, from: number, to: number) =>
    handle.db.insert(locationPoints).values(
      Array.from({ length: to - from + 1 }, (_, i) => ({
        vehicleId: 'v1',
        driveId,
        ts: at(from + i),
        lat: 40 + (from + i) / 1000,
        lon: -89,
      })),
    );
  const row = async (id: number) =>
    (await handle.db.select().from(drives).where(eq(drives.id, id)))[0]!;
  const service = (lookup: TemperatureLookup, options = {}) =>
    new DriveWeather(handle.db, lookup, undefined, { spacingMs: 0, passMs: 60_000, ...options });

  beforeAll(async () => {
    await runMigrations(url!, join(here, '..', '..', 'drizzle'));
    handle = createDb(url!);
  });
  afterAll(async () => {
    await handle.sql.end();
  });
  beforeEach(async () => {
    await handle.sql`TRUNCATE vehicles RESTART IDENTITY CASCADE`;
    await handle.db.insert(vehicles).values({ id: 'v1', vin: 'VIN1' });
  });

  it('samples a finished drive every 10 minutes in one request and sums it up', async () => {
    const requests: number[] = [];
    const id = await drive(20);
    const weather = service(fakeLookup(requests));
    await weather.start();
    await weather.idle();
    weather.stop();

    // 0, 10 and the end at 20.
    expect(requests).toEqual([3]);
    const done = await row(id);
    expect(done.avgOutsideTempC).toBeCloseTo(11);
    expect(done.minOutsideTempC).toBeCloseTo(10);
    expect(done.maxOutsideTempC).toBeCloseTo(12);
    expect(done.weatherCode).toBe(3);
    expect(done.windKmh).toBeCloseTo(10);
    expect(done.windFromDeg).toBeCloseTo(270);
    expect(done.weatherCheckedAt).not.toBeNull();
  });

  it('waits for a drive under way to end', async () => {
    const requests: number[] = [];
    const id = await drive(4, false);
    const weather = service(fakeLookup(requests));
    await weather.start();
    await weather.idle();
    weather.enqueue(id);
    await weather.idle();
    expect(requests).toEqual([]);
    expect((await row(id)).weatherCheckedAt).toBeNull();

    await points(id, 5, 10);
    await handle.db
      .update(drives)
      .set({ endedAt: at(10) })
      .where(eq(drives.id, id));
    weather.enqueue(id);
    await weather.idle();
    weather.stop();
    expect(requests).toEqual([2]); // 0 and the end at 10
    const done = await row(id);
    expect(done.maxOutsideTempC).toBeCloseTo(11);
    expect(done.weatherCheckedAt).not.toBeNull();
  });

  it('skips non-drives and uses the ends of drives without a track', async () => {
    const requests: number[] = [];
    const gearCheck = await drive(1, true, 0.01);
    const [noTrack] = await handle.db
      .insert(drives)
      .values({
        vehicleId: 'v1',
        startedAt: at(0),
        endedAt: at(30),
        startLat: 40,
        startLon: -89,
        endLat: 40.2,
        endLon: -89,
      })
      .returning();
    const weather = service(fakeLookup(requests));
    await weather.start();
    await weather.idle();
    weather.stop();

    expect(requests).toEqual([2]);
    expect((await row(gearCheck)).weatherCheckedAt).not.toBeNull();
    expect((await row(gearCheck)).avgOutsideTempC).toBeNull();
    // Its start and end, 30 minutes apart.
    const ends = await row(noTrack!.id);
    expect(ends.minOutsideTempC).toBeCloseTo(10);
    expect(ends.maxOutsideTempC).toBeCloseTo(13);
  });

  it('waits a day for GPS that arrives after a drive ends', async () => {
    const requests: number[] = [];
    const [late] = await handle.db
      .insert(drives)
      .values({ vehicleId: 'v1', startedAt: at(0), endedAt: at(30), distanceKm: 10 })
      .returning();
    let now = START + 31 * 60_000;
    const weather = service(fakeLookup(requests), { now: () => now });
    await weather.start();
    await weather.idle();
    expect(requests).toEqual([]);
    expect((await row(late!.id)).weatherCheckedAt).toBeNull();

    await points(late!.id, 0, 30);
    weather.enqueue(late!.id);
    await weather.idle();
    expect(requests).toEqual([4]);
    expect((await row(late!.id)).avgOutsideTempC).not.toBeNull();

    // One that never gets any is given up on after the day.
    const [never] = await handle.db
      .insert(drives)
      .values({ vehicleId: 'v1', startedAt: at(0), endedAt: at(30), distanceKm: 10 })
      .returning();
    now = START + 25 * 3600_000;
    weather.enqueue(never!.id);
    await weather.idle();
    weather.stop();
    expect(requests).toEqual([4]);
    expect((await row(never!.id)).weatherCheckedAt).not.toBeNull();
  });

  it('leaves a drive pending when a lookup fails', async () => {
    let fail = true;
    const requests: number[] = [];
    const ok = fakeLookup(requests);
    const flaky: TemperatureLookup = async (...args) => {
      if (fail) throw new Error('offline');
      return ok(...args);
    };
    let now = START;
    const id = await drive(20);
    const weather = service(flaky, { now: () => now });
    await weather.start();
    await weather.idle();
    expect((await row(id)).weatherCheckedAt).toBeNull();

    // Backing off: ignored until the retry time.
    fail = false;
    weather.enqueue(id);
    await weather.idle();
    expect(requests).toEqual([]);

    now += 60 * 60_000;
    weather.enqueue(id);
    await weather.idle();
    weather.stop();
    expect(requests).toEqual([3]);
    expect((await row(id)).weatherCheckedAt).not.toBeNull();
  });

  it('stops for the hour once its call budget is spent', async () => {
    const requests: number[] = [];
    const first = await drive(20);
    const second = await drive(20, true, 10, 60);
    const weather = service(fakeLookup(requests), { hourlyBudget: 4 });
    await weather.start();
    await weather.idle();
    weather.stop();

    expect(requests).toEqual([3]);
    const checked = [await row(first), await row(second)].filter((d) => d.weatherCheckedAt);
    expect(checked).toHaveLength(1);
  });
});
