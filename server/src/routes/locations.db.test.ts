/** Integration test against a real Postgres; skipped unless TEST_DATABASE_URL is set. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import type { ChargingSessionDto, SavedLocation } from '../api-types.js';
import type { AppContext } from '../context.js';
import { createDb, runMigrations } from '../db/client.js';
import {
  appSettings,
  chargingSessions,
  savedLocations,
  vehicles,
  wallboxes,
} from '../db/schema.js';
import { chargingRoutes } from './charging.js';
import { locationRoutes } from './locations.js';

const url = process.env.TEST_DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));
const migrations = join(here, '..', '..', 'drizzle');

const HOME = { lat: 33.0714, lon: -117.2567 };
const WORK = { lat: 33.13, lon: -117.32 };
const input = (over: Partial<SavedLocation> = {}) => ({
  name: 'Work',
  ...WORK,
  radiusM: 200,
  isHome: false,
  ratePerKwh: 0,
  ...over,
});

describe.skipIf(!url)('saved locations with Postgres', () => {
  let handle: ReturnType<typeof createDb>;
  const placesChanged = vi.fn();

  beforeAll(async () => {
    await runMigrations(url!, migrations);
    handle = createDb(url!);
  });
  afterAll(async () => {
    await handle.sql.end();
  });
  beforeEach(async () => {
    await handle.sql`TRUNCATE app_settings, saved_locations, wallboxes, charging_sessions, vehicles RESTART IDENTITY CASCADE`;
    placesChanged.mockClear();
  });

  const app = async () => {
    const server = Fastify();
    server.setErrorHandler((err, _req, reply) =>
      reply.code(err instanceof ZodError ? 400 : 500).send({ error: String(err) }),
    );
    const ctx = {
      db: handle.db,
      notifications: { placesChanged },
      searchPlaces: async () => [],
    } as unknown as AppContext;
    await locationRoutes(server, ctx);
    await chargingRoutes(server, ctx);
    return server;
  };

  /** Re-runs the migration's step that carries the old home settings over. */
  const carryOver = async () => {
    const sql = readFileSync(join(migrations, '0016_saved_locations.sql'), 'utf8');
    await handle.sql.unsafe(sql.split('--> statement-breakpoint')[1]!);
    return handle.db.select().from(savedLocations);
  };

  describe('migration', () => {
    it('makes the home location and rate a Home location', async () => {
      await handle.db.insert(appSettings).values({
        key: 'home_charging',
        value: JSON.stringify({
          ratePerKwh: 0.131,
          currency: 'USD',
          homeLat: HOME.lat,
          homeLon: HOME.lon,
        }),
      });
      const [home, ...rest] = await carryOver();
      expect(rest).toEqual([]);
      expect(home).toMatchObject({ name: 'Home', ...HOME, radiusM: 150, isHome: true });
      expect(home!.ratePerKwh).toBeCloseTo(0.131);
    });

    it('puts Home at the Wall Charger when only a rate was set', async () => {
      await handle.db.insert(wallboxes).values({ wallboxId: 'wb1', latitude: 1, longitude: 2 });
      await handle.db.insert(appSettings).values({
        key: 'home_charging',
        value: JSON.stringify({ ratePerKwh: 0.2, currency: 'USD', homeLat: null, homeLon: null }),
      });
      expect(await carryOver()).toMatchObject([{ name: 'Home', lat: 1, lon: 2, isHome: true }]);
    });

    it('adds nothing when neither was set', async () => {
      await handle.db.insert(wallboxes).values({ wallboxId: 'wb1', latitude: 1, longitude: 2 });
      await handle.db.insert(appSettings).values({
        key: 'home_charging',
        value: JSON.stringify({ ratePerKwh: null, currency: 'USD', homeLat: null, homeLon: null }),
      });
      expect(await carryOver()).toEqual([]);
    });
  });

  it('creates, lists, edits and deletes locations', async () => {
    const server = await app();
    const created = await server.inject({
      method: 'POST',
      url: '/api/locations',
      payload: input(),
    });
    expect(created.statusCode).toBe(201);
    const work = created.json<SavedLocation>();
    expect(work).toEqual({ id: 1, ...input() });

    const edited = await server.inject({
      method: 'PUT',
      url: `/api/locations/${work.id}`,
      payload: input({ name: 'Office', radiusM: 400 }),
    });
    expect(edited.json()).toMatchObject({ id: 1, name: 'Office', radiusM: 400 });
    expect((await server.inject('/api/locations')).json()).toHaveLength(1);

    expect(
      (await server.inject({ method: 'DELETE', url: `/api/locations/${work.id}` })).statusCode,
    ).toBe(204);
    expect((await server.inject({ method: 'DELETE', url: '/api/locations/1' })).statusCode).toBe(
      404,
    );
    expect(placesChanged).toHaveBeenCalledTimes(3);
  });

  it('rejects an invalid location', async () => {
    const server = await app();
    for (const bad of [
      input({ name: ' ' }),
      input({ radiusM: 10 }),
      input({ radiusM: 5000 }),
      input({ ratePerKwh: -1 }),
      input({ lat: 91 }),
    ]) {
      const res = await server.inject({ method: 'POST', url: '/api/locations', payload: bad });
      expect(res.statusCode).toBe(400);
    }
  });

  it("prices sessions at each location's rate", async () => {
    await handle.db.insert(vehicles).values({ id: 'v1', vin: 'VIN1' });
    await handle.db.insert(savedLocations).values([
      { name: 'Home', ...HOME, isHome: true, ratePerKwh: 0.131 },
      { name: 'Work', ...WORK, radiusM: 200, ratePerKwh: 0 },
    ]);
    const session = (lat: number | null, lon: number | null, over = {}) => ({
      vehicleId: 'v1',
      startedAt: new Date('2026-10-01T00:00:00Z'),
      endedAt: new Date('2026-10-01T02:00:00Z'),
      energyKwh: 40,
      lat,
      lon,
      ...over,
    });
    await handle.db.insert(chargingSessions).values([
      session(HOME.lat, HOME.lon, { startedAt: new Date('2026-10-04T00:00:00Z') }),
      // A public workplace charger is still priced at Work's rate.
      session(WORK.lat, WORK.lon, { startedAt: new Date('2026-10-03T00:00:00Z'), isPublic: true }),
      session(WORK.lat, WORK.lon, {
        startedAt: new Date('2026-10-02T00:00:00Z'),
        cost: '3.10',
        currency: 'USD',
      }),
      session(40, -100),
      // Rivian's history can have a Wall Charger session with no position.
      session(null, null, { startedAt: new Date('2026-09-30T00:00:00Z'), isHomeCharger: true }),
    ]);

    const rows = (await (await app()).inject('/api/vehicles/v1/charging-sessions')).json<
      ChargingSessionDto[]
    >();
    expect(rows.map((r) => [r.location?.name ?? null, r.isHome, r.estimatedCost, r.cost])).toEqual([
      ['Home', true, '5.24', null],
      ['Work', false, '0.00', null],
      ['Work', false, null, '3.10'],
      [null, false, null, null],
      [null, true, '5.24', null],
    ]);
  });
});
