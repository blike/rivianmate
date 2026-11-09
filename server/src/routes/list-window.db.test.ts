/** Integration test against a real Postgres; skipped unless TEST_DATABASE_URL is set. */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ChargingSessionDto, DriveCoverageDto, DriveDto } from '../api-types.js';
import type { AppContext } from '../context.js';
import { createDb, runMigrations } from '../db/client.js';
import { chargingSessions, drivers, drives, locationPoints, vehicles } from '../db/schema.js';
import { chargingRoutes } from './charging.js';
import { historyRoutes } from './history.js';

const url = process.env.TEST_DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));
const migrations = join(here, '..', '..', 'drizzle');

const day = (n: number) => new Date(Date.UTC(2026, 9, n, 12));

describe.skipIf(!url)('listing drives and charging sessions in a window', () => {
  let handle: ReturnType<typeof createDb>;

  beforeAll(async () => {
    await runMigrations(url!, migrations);
    handle = createDb(url!);
  });
  afterAll(async () => {
    await handle.sql.end();
  });
  beforeEach(async () => {
    await handle.sql`TRUNCATE drives, charging_sessions, vehicles RESTART IDENTITY CASCADE`;
    await handle.db.insert(vehicles).values({ id: 'v1', vin: 'VIN1' });
  });

  const app = async () => {
    const server = Fastify();
    const ctx = { db: handle.db, monitor: { getState: () => undefined } } as unknown as AppContext;
    await historyRoutes(server, ctx);
    await chargingRoutes(server, ctx);
    return server;
  };
  const get = async <T>(path: string) => {
    const res = await (await app()).inject(path);
    if (res.statusCode !== 200) throw new Error(res.body);
    return res.json<T>();
  };

  it('lists only what started in the window, and every one of them', async () => {
    await handle.db.insert(drives).values(
      Array.from({ length: 250 }, (_, i) => ({
        vehicleId: 'v1',
        startedAt: new Date(day(10).getTime() + i * 60_000),
        endedAt: new Date(day(10).getTime() + i * 60_000 + 30_000),
        distanceKm: 5,
      })),
    );
    await handle.db.insert(drives).values({
      vehicleId: 'v1',
      startedAt: day(2),
      endedAt: day(2),
      distanceKm: 5,
    });
    await handle.db.insert(chargingSessions).values([
      { vehicleId: 'v1', startedAt: day(1), endedAt: day(1), energyKwh: 10 },
      { vehicleId: 'v1', startedAt: day(12), endedAt: day(12), energyKwh: 20 },
    ]);
    const window = `from=${day(9).toISOString()}&to=${day(20).toISOString()}`;

    expect(await get<DriveDto[]>('/api/vehicles/v1/drives')).toHaveLength(200);
    expect(await get<DriveDto[]>(`/api/vehicles/v1/drives?${window}`)).toHaveLength(250);
    const sessions = await get<ChargingSessionDto[]>(
      `/api/vehicles/v1/charging-sessions?${window}`,
    );
    expect(sessions.map((s) => s.energyKwh)).toEqual([20]);
    expect(await get<ChargingSessionDto[]>('/api/vehicles/v1/charging-sessions')).toHaveLength(2);
  });

  it('pages back through everything, newest first, with nothing twice', async () => {
    const start = (i: number) => new Date(day(1).getTime() + i * 60_000);
    await handle.db.insert(drives).values(
      Array.from({ length: 450 }, (_, i) => ({
        vehicleId: 'v1',
        startedAt: start(i),
        endedAt: new Date(start(i).getTime() + 30_000),
        distanceKm: 5,
      })),
    );
    await handle.db.insert(chargingSessions).values(
      Array.from({ length: 201 }, (_, i) => ({
        vehicleId: 'v1',
        startedAt: start(i),
        energyKwh: 1,
      })),
    );

    const seen: string[] = [];
    let page = await get<DriveDto[]>('/api/vehicles/v1/drives');
    while (page.length > 0) {
      seen.push(...page.map((d) => d.startedAt));
      if (page.length < 200) break;
      page = await get<DriveDto[]>(`/api/vehicles/v1/drives?before=${page.at(-1)!.startedAt}`);
    }
    expect(seen).toHaveLength(450);
    expect(new Set(seen).size).toBe(450);
    expect(seen.at(-1)).toBe(start(0).toISOString());

    const first = await get<ChargingSessionDto[]>('/api/vehicles/v1/charging-sessions');
    const rest = await get<ChargingSessionDto[]>(
      `/api/vehicles/v1/charging-sessions?before=${first.at(-1)!.startedAt}`,
    );
    expect([first.length, rest.length]).toEqual([200, 1]);
    expect(rest[0]!.startedAt).toBe(start(0).toISOString());
  });

  it('lists every drive and session in a window, past the old 5,000 cap', async () => {
    const n = 5_001;
    const at = (i: number) => new Date(day(1).getTime() + i * 60_000);
    await handle.db.insert(drives).values(
      Array.from({ length: n }, (_, i) => ({
        vehicleId: 'v1',
        startedAt: at(i),
        endedAt: new Date(at(i).getTime() + 30_000),
        distanceKm: 5,
      })),
    );
    await handle.db
      .insert(chargingSessions)
      .values(Array.from({ length: n }, (_, i) => ({ vehicleId: 'v1', startedAt: at(i) })));
    const window = `from=${day(1).toISOString()}&to=${day(20).toISOString()}`;

    const listed = await get<DriveDto[]>(`/api/vehicles/v1/drives?${window}`);
    expect(listed).toHaveLength(n);
    // The oldest is there too, not just the newest 5,000.
    expect(listed.at(-1)!.startedAt).toBe(at(0).toISOString());
    expect(
      await get<ChargingSessionDto[]>(`/api/vehicles/v1/charging-sessions?${window}`),
    ).toHaveLength(n);
  });

  it('says when drive history starts', async () => {
    expect(await get<DriveCoverageDto>('/api/vehicles/v1/drive-coverage')).toEqual({
      since: null,
    });
    await handle.db.insert(drives).values([
      { vehicleId: 'v1', startedAt: day(5) },
      { vehicleId: 'v1', startedAt: day(3) },
    ]);
    expect(await get<DriveCoverageDto>('/api/vehicles/v1/drive-coverage')).toEqual({
      since: day(3).toISOString(),
    });
  });

  it("averages a long window's points per drive, and keeps a short one's", async () => {
    const [drive] = await handle.db
      .insert(drives)
      .values({ vehicleId: 'v1', startedAt: day(10), endedAt: day(10), distanceKm: 5 })
      .returning();
    // A point a second for a minute, heading north, from a bucket's start.
    const t0 = Date.UTC(2026, 9, 10, 12, 0, 0);
    await handle.db.insert(locationPoints).values(
      Array.from({ length: 60 }, (_, i) => ({
        vehicleId: 'v1',
        ts: new Date(t0 + i * 1000),
        lat: 40 + i * 0.0001,
        lon: -88,
        bearing: 0,
        driveId: drive!.id,
      })),
    );
    type Point = { ts: string; lat: number; driveId: number | null };
    const at = (from: Date, to: Date) =>
      get<Point[]>(`/api/vehicles/v1/locations?from=${from.toISOString()}&to=${to.toISOString()}`);

    // A straight line simplifies to its ends either way; what differs is where they are.
    const short = await at(day(9), day(12));
    expect(short.map((p) => p.ts)).toEqual([
      new Date(t0).toISOString(),
      new Date(t0 + 59_000).toISOString(),
    ]);
    // Over a year, 15 seconds a point: the first averages the first 15.
    const long = await at(new Date(t0 - 300 * 86_400_000), day(20));
    expect(long[0]!.ts).toBe(new Date(t0).toISOString());
    expect(long[0]!.lat).toBeCloseTo(40 + 7 * 0.0001, 6);
    expect(long.at(-1)!.ts).toBe(new Date(t0 + 45_000).toISOString());
    expect(new Set([...short, ...long].map((p) => p.driveId))).toEqual(
      new Set([short[0]!.driveId]),
    );
    expect(Number(long[0]!.driveId)).toBe(drive!.id);
  });

  it('counts time moving, leaving out stops even between readings at speed', async () => {
    const [row] = await handle.db
      .insert(drives)
      .values({ vehicleId: 'v1', startedAt: day(10), endedAt: day(11), distanceKm: 22 })
      .returning({ id: drives.id });
    const point = (minutes: number, lat: number) => ({
      vehicleId: 'v1',
      driveId: row!.id,
      ts: new Date(day(10).getTime() + minutes * 60_000),
      lat,
      lon: -117,
      speedKmh: 40,
    });
    await handle.db
      .insert(locationPoints)
      .values([point(0, 33), point(10, 33.1), point(40, 33.1), point(50, 33.2)]);

    const [listed] = await get<DriveDto[]>('/api/vehicles/v1/drives');
    expect(listed!.movingSeconds).toBe(1200);
    const one = await get<DriveDto>(`/api/vehicles/v1/drives/${row!.id}`);
    expect(one.movingSeconds).toBe(1200);
  });

  it("names each drive's driver: the user's name, the reported one, else by number", async () => {
    const ids = (
      await handle.db
        .insert(drivers)
        .values([
          { vehicleId: 'v1', profileId: 'p1', reportedName: 'Alex' },
          { vehicleId: 'v1', profileId: 'p2' },
          { vehicleId: 'v1', profileId: 'p3', name: 'Sam', reportedName: 'Driver' },
        ])
        .returning({ id: drivers.id })
    ).map((r) => r.id);
    const drive = (minutes: number, driverId: number | null, driverSource: string | null) => ({
      vehicleId: 'v1',
      startedAt: new Date(day(10).getTime() + minutes * 60_000),
      endedAt: new Date(day(10).getTime() + minutes * 60_000 + 30_000),
      distanceKm: 5,
      driverId,
      driverSource: driverSource as 'profile' | 'manual' | 'none' | null,
    });
    await handle.db
      .insert(drives)
      .values([
        drive(0, ids[0]!, 'profile'),
        drive(1, ids[1]!, 'profile'),
        drive(2, ids[2]!, 'manual'),
        drive(3, null, 'none'),
        drive(4, null, null),
      ]);

    const listed = await get<DriveDto[]>('/api/vehicles/v1/drives');
    expect(listed.map((d) => d.driver)).toEqual([
      null,
      null,
      { id: ids[2], name: 'Sam', source: 'manual' },
      { id: ids[1], name: 'Driver 2', source: 'profile' },
      { id: ids[0], name: 'Alex', source: 'profile' },
    ]);
    const one = await get<DriveDto>(`/api/vehicles/v1/drives/${listed[4]!.id}`);
    expect(one.driver).toEqual({ id: ids[0], name: 'Alex', source: 'profile' });
  });

  it('lists the drivers to pick from, and keeps the one picked for a drive, or nobody', async () => {
    await handle.db.insert(vehicles).values({ id: 'v2', vin: 'VIN2' });
    const [alex, sam, other] = (
      await handle.db
        .insert(drivers)
        .values([
          { vehicleId: 'v1', profileId: 'p1', reportedName: 'Alex' },
          { vehicleId: 'v1', profileId: 'p2', name: 'Sam' },
          { vehicleId: 'v2', profileId: 'p3', name: 'Elsewhere' },
        ])
        .returning({ id: drivers.id })
    ).map((r) => r.id);
    const [drive] = await handle.db
      .insert(drives)
      .values({
        vehicleId: 'v1',
        startedAt: day(10),
        endedAt: day(10),
        distanceKm: 5,
        driverId: alex,
        driverSource: 'profile',
      })
      .returning({ id: drives.id });
    const server = await app();
    const pick = (driverId: number | null) =>
      server.inject({
        method: 'PUT',
        url: `/api/drives/${drive!.id}/driver`,
        payload: { driverId },
      });

    expect(await get('/api/vehicles/v1/drivers')).toEqual([
      { id: alex, name: 'Alex' },
      { id: sam, name: 'Sam' },
    ]);

    expect((await pick(sam!)).statusCode).toBe(204);
    expect((await get<DriveDto>(`/api/vehicles/v1/drives/${drive!.id}`)).driver).toEqual({
      id: sam,
      name: 'Sam',
      source: 'manual',
    });

    expect((await pick(other!)).statusCode).toBe(400);
    expect((await pick(null)).statusCode).toBe(204);
    const [row] = await handle.db.select().from(drives).where(eq(drives.id, drive!.id));
    expect(row).toMatchObject({ driverId: null, driverSource: 'manual' });
    expect((await get<DriveDto>(`/api/vehicles/v1/drives/${drive!.id}`)).driver).toBeNull();
  });
});
