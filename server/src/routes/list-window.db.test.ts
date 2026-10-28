/** Integration test against a real Postgres; skipped unless TEST_DATABASE_URL is set. */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ChargingSessionDto, DriveCoverageDto, DriveDto } from '../api-types.js';
import type { AppContext } from '../context.js';
import { createDb, runMigrations } from '../db/client.js';
import { chargingSessions, drives, vehicles } from '../db/schema.js';
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
});
