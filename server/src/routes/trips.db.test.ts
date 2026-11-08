/** Integration test against a real Postgres; skipped unless TEST_DATABASE_URL is set. */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import type {
  TripCandidatesDto,
  TripDetailDto,
  TripDto,
  TripRouteDto,
  TripSummaryDto,
} from '../api-types.js';
import type { AppContext } from '../context.js';
import { createDb, runMigrations } from '../db/client.js';
import {
  chargingSessions,
  drives,
  locationPoints,
  tripActivities,
  tripExclusions,
  trips,
  vehicles,
} from '../db/schema.js';
import { tripRoutes } from './trips.js';

const url = process.env.TEST_DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));
const migrations = join(here, '..', '..', 'drizzle');

const at = (day: number, hour = 12) => new Date(Date.UTC(2026, 5, day, hour));

describe.skipIf(!url)('trips', () => {
  let handle: ReturnType<typeof createDb>;

  beforeAll(async () => {
    await runMigrations(url!, migrations);
    handle = createDb(url!);
  });
  afterAll(async () => {
    await handle.sql.end();
  });
  beforeEach(async () => {
    await handle.sql`TRUNCATE trips, trip_activities, drives, charging_sessions, location_points, vehicles RESTART IDENTITY CASCADE`;
    await handle.db.insert(vehicles).values([
      { id: 'v1', vin: 'VIN1' },
      { id: 'v2', vin: 'VIN2' },
    ]);
  });

  const teslamate = {
    getVehicles: () => [{ id: 'tm-1' }],
    drivesByIds: async () => [],
    chargingSessionsByIds: async () => [],
    drivePoints: async () => [],
  };

  const app = async () => {
    const server = Fastify();
    server.setErrorHandler((err, _req, reply) =>
      reply.code(err instanceof ZodError ? 400 : 500).send({ error: String(err) }),
    );
    const ctx = {
      db: handle.db,
      monitor: { getState: () => undefined },
      teslamate,
    } as unknown as AppContext;
    await tripRoutes(server, ctx);
    return server;
  };

  const call = async (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    payload?: object,
  ) => (await app()).inject({ method, url: path, ...(payload ? { payload } : {}) });

  const createTrip = async (name: string, vehicle = 'v1') => {
    const res = await call('POST', `/api/vehicles/${vehicle}/trips`, { name });
    expect(res.statusCode).toBe(201);
    return res.json<TripDto>();
  };

  const addDrive = async (over: Partial<typeof drives.$inferInsert> = {}) => {
    const [row] = await handle.db
      .insert(drives)
      .values({
        vehicleId: 'v1',
        startedAt: at(1),
        endedAt: at(1, 13),
        distanceKm: 100,
        startBattery: 80,
        endBattery: 60,
        batteryCapacityKwh: 100,
        ...over,
      })
      .returning();
    return row!;
  };

  const addCharge = async (over: Partial<typeof chargingSessions.$inferInsert> = {}) => {
    const [row] = await handle.db
      .insert(chargingSessions)
      .values({
        vehicleId: 'v1',
        startedAt: at(1, 14),
        endedAt: at(1, 15),
        chargingSeconds: 1800,
        energyKwh: 40,
        ...over,
      })
      .returning();
    return row!;
  };

  const add = (tripId: number, items: object[], move = false, vehicle = 'v1') =>
    call('POST', `/api/vehicles/${vehicle}/trips/${tripId}/activities`, { items, move });

  it('creates, edits, lists and shows a trip with its activities and totals', async () => {
    const trip = await createTrip('Yosemite Road Trip 2026');
    const drive = await addDrive();
    const charge = await addCharge();
    const added = await add(trip.id, [
      { kind: 'drive', id: drive.id },
      { kind: 'charge', id: charge.id },
    ]);
    expect(added.statusCode).toBe(204);

    const patched = await call('PATCH', `/api/vehicles/v1/trips/${trip.id}`, {
      name: 'Yosemite',
      notes: 'Camping',
      startDate: '2026-06-01',
      endDate: '2026-06-05',
      timeZone: 'UTC',
    });
    expect(patched.json<TripDto>()).toMatchObject({
      name: 'Yosemite',
      notes: 'Camping',
      startDate: '2026-06-01',
    });

    const detail = (await call('GET', `/api/vehicles/v1/trips/${trip.id}`)).json<TripDetailDto>();
    expect(detail.drives.map((d) => d.id)).toEqual([drive.id]);
    expect(detail.sessions.map((s) => s.id)).toEqual([charge.id]);
    expect(detail.missing).toBe(0);
    expect(detail.stats).toMatchObject({
      distanceKm: 100,
      energyUsedKwh: 20,
      energyAddedKwh: 40,
      chargingSeconds: 1800,
      drivingSeconds: 3600,
    });

    const list = (await call('GET', '/api/vehicles/v1/trips')).json<TripSummaryDto[]>();
    expect(list.map((t) => [t.name, t.stats.drives, t.stats.charges])).toEqual([
      ['Yosemite', 1, 1],
    ]);
  });

  it('lists a vehicle’s trips, newest journey first, with each one’s own totals', async () => {
    const older = await createTrip('Older');
    const newer = await createTrip('Newer');
    await add(older.id, [{ kind: 'drive', id: (await addDrive({ distanceKm: 10 })).id }]);
    await add(newer.id, [
      {
        kind: 'drive',
        id: (await addDrive({ startedAt: at(9), endedAt: at(9, 13), distanceKm: 20 })).id,
      },
    ]);
    await createTrip('Another vehicle’s', 'v2');
    const list = (await call('GET', '/api/vehicles/v1/trips')).json<TripSummaryDto[]>();
    expect(list.map((t) => [t.name, t.stats.distanceKm])).toEqual([
      ['Newer', 20],
      ['Older', 10],
    ]);
  });

  it('rejects a blank name, an impossible date and dates out of order', async () => {
    const post = (body: object) =>
      call('POST', '/api/vehicles/v1/trips', { timeZone: 'UTC', ...body });
    expect((await post({ name: '  ' })).statusCode).toBe(400);
    expect((await post({ name: 'A', startDate: '2026-02-31' })).statusCode).toBe(400);
    expect(
      (await post({ name: 'A', startDate: '2026-06-02', endDate: '2026-06-01' })).statusCode,
    ).toBe(400);
    const trip = await createTrip('A');
    await call('PATCH', `/api/vehicles/v1/trips/${trip.id}`, {
      startDate: '2026-06-02',
      timeZone: 'UTC',
    });
    const res = await call('PATCH', `/api/vehicles/v1/trips/${trip.id}`, { endDate: '2026-06-01' });
    expect(res.statusCode).toBe(400);
  });

  it('won’t create a trip for a vehicle it doesn’t know', async () => {
    const res = await call('POST', '/api/vehicles/nope/trips', { name: 'A' });
    expect(res.statusCode).toBe(404);
  });

  it('refuses an activity that’s in another trip until asked to move it', async () => {
    const first = await createTrip('First');
    const second = await createTrip('Second');
    const drive = await addDrive();
    const free = await addDrive({ startedAt: at(2), endedAt: at(2, 13) });
    await add(first.id, [{ kind: 'drive', id: drive.id }]);

    const refused = await add(second.id, [
      { kind: 'drive', id: free.id },
      { kind: 'drive', id: drive.id },
    ]);
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ error: string }>().error).toContain('First');
    // All or nothing: the free drive wasn't added either.
    expect(
      await handle.db.select().from(tripActivities).where(eq(tripActivities.tripId, second.id)),
    ).toEqual([]);

    expect((await add(second.id, [{ kind: 'drive', id: drive.id }], true)).statusCode).toBe(204);
    const links = await handle.db.select().from(tripActivities);
    expect(links.map((l) => l.tripId)).toEqual([second.id]);
  });

  it('adding what’s already in the trip changes nothing', async () => {
    const trip = await createTrip('A');
    const drive = await addDrive();
    await add(trip.id, [{ kind: 'drive', id: drive.id }]);
    const again = await add(trip.id, [
      { kind: 'drive', id: drive.id },
      { kind: 'drive', id: drive.id },
    ]);
    expect(again.statusCode).toBe(204);
    expect(await handle.db.select().from(tripActivities)).toHaveLength(1);
  });

  it('a drive and a charge sharing an id are different activities', async () => {
    const trip = await createTrip('A');
    const drive = await addDrive();
    const charge = await addCharge();
    expect(drive.id).toBe(charge.id);
    const res = await add(trip.id, [
      { kind: 'drive', id: drive.id },
      { kind: 'charge', id: charge.id },
    ]);
    expect(res.statusCode).toBe(204);
    expect(await handle.db.select().from(tripActivities)).toHaveLength(2);
  });

  it('only takes the vehicle’s own finished records', async () => {
    const trip = await createTrip('A');
    const running = await addDrive({ endedAt: null });
    const others = await addDrive({ vehicleId: 'v2' });
    for (const id of [running.id, others.id, 999]) {
      expect((await add(trip.id, [{ kind: 'drive', id }])).statusCode).toBe(400);
    }
    expect(await handle.db.select().from(tripActivities)).toEqual([]);
  });

  it('removes an activity without touching the record', async () => {
    const trip = await createTrip('A');
    const drive = await addDrive();
    await add(trip.id, [{ kind: 'drive', id: drive.id }]);
    const res = await call(
      'DELETE',
      `/api/vehicles/v1/trips/${trip.id}/activities/drive/${drive.id}`,
    );
    expect(res.statusCode).toBe(204);
    expect(await handle.db.select().from(tripActivities)).toEqual([]);
    expect(await handle.db.select().from(drives)).toHaveLength(1);
  });

  it('deleting a trip frees its activities and leaves the records', async () => {
    const trip = await createTrip('A');
    const drive = await addDrive();
    const charge = await addCharge();
    await add(trip.id, [
      { kind: 'drive', id: drive.id },
      { kind: 'charge', id: charge.id },
    ]);
    const res = await call('DELETE', `/api/vehicles/v1/trips/${trip.id}`);
    expect(res.statusCode).toBe(204);
    expect(await handle.db.select().from(tripActivities)).toEqual([]);
    expect(await handle.db.select().from(trips)).toEqual([]);
    expect(await handle.db.select().from(drives)).toHaveLength(1);
    expect(await handle.db.select().from(chargingSessions)).toHaveLength(1);
  });

  it('can’t reach another vehicle’s trip', async () => {
    const trip = await createTrip('A');
    const drive = await addDrive();
    expect((await call('GET', `/api/vehicles/v2/trips/${trip.id}`)).statusCode).toBe(404);
    expect((await call('DELETE', `/api/vehicles/v2/trips/${trip.id}`)).statusCode).toBe(404);
    expect((await add(trip.id, [{ kind: 'drive', id: drive.id }], false, 'v2')).statusCode).toBe(
      404,
    );
  });

  it('reports linked records it can’t read instead of failing', async () => {
    const trip = await createTrip('A');
    await handle.db
      .insert(tripActivities)
      .values({ tripId: trip.id, vehicleId: 'v1', kind: 'drive', activityId: 12345 });
    const detail = (await call('GET', `/api/vehicles/v1/trips/${trip.id}`)).json<TripDetailDto>();
    expect(detail.missing).toBe(1);
    expect(detail.stats.drives).toBe(0);
  });

  it('keeps TeslaMate trips apart from a Rivian record with the same id', async () => {
    const rivian = await createTrip('Rivian');
    const tm = await createTrip('TeslaMate', 'tm-1');
    const drive = await addDrive();
    await add(rivian.id, [{ kind: 'drive', id: drive.id }]);
    await handle.db
      .insert(tripActivities)
      .values({ tripId: tm.id, vehicleId: 'tm-1', kind: 'drive', activityId: drive.id });
    const links = await handle.db.select().from(tripActivities);
    expect(links).toHaveLength(2);
    const detail = (await call('GET', `/api/vehicles/tm-1/trips/${tm.id}`)).json<TripDetailDto>();
    expect(detail.missing).toBe(1);
  });

  it('draws only the trip’s drives, one line each', async () => {
    const trip = await createTrip('A');
    const inTrip = await addDrive();
    const outside = await addDrive({ startedAt: at(1, 13), endedAt: at(1, 14) });
    const point = (driveId: number, minute: number, lat: number) => ({
      vehicleId: 'v1',
      driveId,
      ts: new Date(at(1, driveId === inTrip.id ? 12 : 13).getTime() + minute * 60_000),
      lat,
      lon: -119,
    });
    await handle.db
      .insert(locationPoints)
      .values([
        point(inTrip.id, 0, 37),
        point(inTrip.id, 5, 37.1),
        point(outside.id, 0, 38),
        point(outside.id, 5, 38.1),
      ]);
    await add(trip.id, [{ kind: 'drive', id: inTrip.id }]);
    const route = (await call('GET', `/api/vehicles/v1/trips/${trip.id}/route`)).json<
      TripRouteDto[]
    >();
    expect(route).toEqual([
      {
        driveId: inTrip.id,
        points: [
          [37, -119],
          [37.1, -119],
        ],
        profile: [],
      },
    ]);
  });

  it('offers finished activities in the window, saying which trip each is in', async () => {
    const trip = await createTrip('A');
    const inWindow = await addDrive();
    await addDrive({ startedAt: at(1, 16), endedAt: null });
    await addDrive({ startedAt: at(20), endedAt: at(20, 13) });
    const charge = await addCharge();
    await add(trip.id, [{ kind: 'drive', id: inWindow.id }]);
    const res = await call(
      'GET',
      `/api/vehicles/v1/trip-candidates?from=${at(1, 0).toISOString()}&to=${at(2).toISOString()}`,
    );
    const candidates = res.json<TripCandidatesDto>();
    expect(candidates.drives.map((d) => d.id)).toEqual([inWindow.id]);
    expect(candidates.sessions.map((s) => s.id)).toEqual([charge.id]);
    expect(candidates.assignments).toEqual([
      { kind: 'drive', activityId: inWindow.id, tripId: trip.id, tripName: 'A' },
    ]);
    expect(candidates.excluded).toEqual([]);

    await call('DELETE', `/api/vehicles/v1/trips/${trip.id}/activities/drive/${inWindow.id}`);
    const window = `from=${at(1, 0).toISOString()}&to=${at(2).toISOString()}`;
    const asked = await call('GET', `/api/vehicles/v1/trip-candidates?${window}&tripId=${trip.id}`);
    expect(asked.json<TripCandidatesDto>().excluded).toEqual([{ kind: 'drive', id: inWindow.id }]);
    // Another vehicle's trip says nothing.
    const other = await call('GET', `/api/vehicles/v2/trip-candidates?${window}&tripId=${trip.id}`);
    expect(other.json<TripCandidatesDto>().excluded).toEqual([]);
  });

  describe('by its dates', () => {
    const open = async (over: object = {}) => {
      const res = await call('POST', '/api/vehicles/v1/trips', {
        name: 'Open',
        startDate: '2026-06-02',
        endDate: '2026-06-04',
        timeZone: 'America/Los_Angeles',
        ...over,
      });
      expect(res.statusCode).toBe(201);
      return res.json<TripDto>();
    };
    const linked = async (tripId: number) =>
      (await handle.db.select().from(tripActivities).where(eq(tripActivities.tripId, tripId)))
        .map((l) => `${l.kind}:${l.activityId}`)
        .sort();

    it('takes in finished activities that start within its days, in its zone', async () => {
      // 06-02 00:30 in Los Angeles is 07:30 UTC; 06-01 23:30 there is 06:30 UTC.
      const before = await addDrive({ startedAt: at(2, 6), endedAt: at(2, 7) });
      const first = await addDrive({ startedAt: at(2, 8), endedAt: at(2, 9) });
      const running = await addDrive({ startedAt: at(3, 8), endedAt: null });
      const charge = await addCharge({ startedAt: at(4, 20), endedAt: at(4, 22) });
      const after = await addDrive({ startedAt: at(5, 8), endedAt: at(5, 9) });
      const trip = await open();

      const shown = (await call('GET', `/api/vehicles/v1/trips/${trip.id}`)).json<TripDetailDto>();
      expect(shown.drives.map((d) => d.id)).toEqual([first.id]);
      expect(shown.sessions.map((s) => s.id)).toEqual([charge.id]);
      expect(shown.drives.map((d) => d.id)).not.toContain(before.id);
      expect(shown.drives.map((d) => d.id)).not.toContain(after.id);

      // Once it's done, the running drive joins on the next look.
      await handle.db
        .update(drives)
        .set({ endedAt: at(3, 9) })
        .where(eq(drives.id, running.id));
      const listed = (await call('GET', '/api/vehicles/v1/trips')).json<TripSummaryDto[]>();
      expect(listed[0]!.stats.drives).toBe(2);
    });

    it('offers only what’s new on each look, so ids don’t run on', async () => {
      await addDrive({ startedAt: at(2, 18), endedAt: at(2, 19) });
      await addCharge({ startedAt: at(2, 20), endedAt: at(2, 21) });
      const trip = await open();
      for (let i = 0; i < 3; i++) await call('GET', '/api/vehicles/v1/trips');
      await addDrive({ startedAt: at(3, 18), endedAt: at(3, 19) });
      await call('GET', '/api/vehicles/v1/trips');
      const ids = (
        await handle.db.select().from(tripActivities).where(eq(tripActivities.tripId, trip.id))
      )
        .map((l) => l.id)
        .sort((a, b) => a - b);
      expect(ids).toEqual([1, 2, 3]);
    });

    it('takes in what finished at most once a while, but straight after a change', async () => {
      // One server, as in use: each call above starts afresh.
      const server = await app();
      const get = (url: string) => server.inject({ method: 'GET', url });
      const made = await server.inject({
        method: 'POST',
        url: '/api/vehicles/v1/trips',
        payload: { name: 'Open', startDate: '2026-06-02', timeZone: 'UTC' },
      });
      const trip = made.json<TripDto>();
      await get(`/api/vehicles/v1/trips/${trip.id}`);
      const late = await addDrive({ startedAt: at(3, 18), endedAt: at(3, 19) });
      await get('/api/vehicles/v1/trips');
      expect(await linked(trip.id)).toEqual([]);
      await server.inject({
        method: 'PATCH',
        url: `/api/vehicles/v1/trips/${trip.id}`,
        payload: { name: 'Renamed' },
      });
      await get('/api/vehicles/v1/trips');
      expect(await linked(trip.id)).toEqual([`drive:${late.id}`]);
    });

    it('runs on with no end date, and leaves other trips’ activities alone', async () => {
      const other = await createTrip('Other');
      const taken = await addDrive({ startedAt: at(3, 18), endedAt: at(3, 19) });
      await add(other.id, [{ kind: 'drive', id: taken.id }]);
      const later = await addDrive({ startedAt: at(28, 18), endedAt: at(28, 19) });
      const trip = await open({ endDate: null });
      await call('GET', '/api/vehicles/v1/trip-assignments');
      expect(await linked(trip.id)).toEqual([`drive:${later.id}`]);
      expect(await linked(other.id)).toEqual([`drive:${taken.id}`]);
    });

    it('keeps out what was taken out or moved out, until it’s added back', async () => {
      const drive = await addDrive({ startedAt: at(3, 18), endedAt: at(3, 19) });
      const moved = await addDrive({ startedAt: at(3, 20), endedAt: at(3, 21) });
      const trip = await open();
      const other = await createTrip('Other');
      await call('GET', `/api/vehicles/v1/trips/${trip.id}/route`);
      expect(await linked(trip.id)).toHaveLength(2);

      await call('DELETE', `/api/vehicles/v1/trips/${trip.id}/activities/drive/${drive.id}`);
      expect((await add(other.id, [{ kind: 'drive', id: moved.id }], true)).statusCode).toBe(204);
      await call('DELETE', `/api/vehicles/v1/trips/${other.id}/activities/drive/${moved.id}`);
      await call('GET', `/api/vehicles/v1/trips/${trip.id}`);
      expect(await linked(trip.id)).toEqual([]);

      await add(trip.id, [{ kind: 'drive', id: drive.id }]);
      expect(await linked(trip.id)).toEqual([`drive:${drive.id}`]);
    });

    it('can be told what to keep out as it’s made', async () => {
      const kept = await addDrive({ startedAt: at(3, 18), endedAt: at(3, 19) });
      const skipped = await addDrive({ startedAt: at(3, 20), endedAt: at(3, 21) });
      const trip = await createTrip('Builder');
      const res = await call('POST', `/api/vehicles/v1/trips/${trip.id}/activities`, {
        items: [{ kind: 'drive', id: kept.id }],
        exclude: [{ kind: 'drive', id: skipped.id }],
      });
      expect(res.statusCode).toBe(204);
      await call('PATCH', `/api/vehicles/v1/trips/${trip.id}`, {
        startDate: '2026-06-02',
        timeZone: 'UTC',
      });
      await call('GET', `/api/vehicles/v1/trips/${trip.id}`);
      expect(await linked(trip.id)).toEqual([`drive:${kept.id}`]);
    });

    it('keeps out again what it already keeps out without spending ids', async () => {
      const first = await addDrive({ startedAt: at(3, 18), endedAt: at(3, 19) });
      const second = await addDrive({ startedAt: at(3, 20), endedAt: at(3, 21) });
      const trip = await createTrip('Builder');
      const save = (ids: number[]) =>
        call('POST', `/api/vehicles/v1/trips/${trip.id}/activities`, {
          items: [],
          exclude: ids.map((id) => ({ kind: 'drive', id })),
        });
      // The builder sends everything it keeps out on every save.
      await save([first.id]);
      await save([first.id]);
      await save([first.id, second.id]);
      const ids = (
        await handle.db.select().from(tripExclusions).where(eq(tripExclusions.tripId, trip.id))
      )
        .map((e) => e.id)
        .sort((a, b) => a - b);
      expect(ids).toEqual([1, 2]);
    });

    it('needs a real zone for its dates, and without dates takes nothing in', async () => {
      const post = (over: object) => call('POST', '/api/vehicles/v1/trips', { name: 'A', ...over });
      expect((await post({ startDate: '2026-06-02' })).statusCode).toBe(400);
      expect((await post({ startDate: '2026-06-02', timeZone: 'Mars/Base' })).statusCode).toBe(400);

      const trip = await open();
      const cleared = await call('PATCH', `/api/vehicles/v1/trips/${trip.id}`, {
        startDate: null,
        endDate: null,
      });
      expect(cleared.statusCode).toBe(200);
      await addDrive({ startedAt: at(3, 18), endedAt: at(3, 19) });
      await call('GET', `/api/vehicles/v1/trips/${trip.id}`);
      expect(await linked(trip.id)).toEqual([]);
    });

    it('refuses dates that share a day with another trip', async () => {
      const running = await open({ name: 'Road trip', endDate: null });
      const later = (over: object = {}) =>
        call('POST', '/api/vehicles/v1/trips', {
          name: 'Later',
          startDate: '2026-06-10',
          timeZone: 'UTC',
          ...over,
        });
      const refused = await later();
      expect(refused.statusCode).toBe(409);
      expect(refused.json<{ error: string }>().error).toContain('Road trip');

      // Ended the day before, the later one fits; and a trip without dates never clashes.
      await call('PATCH', `/api/vehicles/v1/trips/${running.id}`, { endDate: '2026-06-09' });
      const fits = await later();
      expect(fits.statusCode).toBe(201);
      expect((await createTrip('No dates')).id).toBeGreaterThan(0);

      // Nor can a trip be moved onto another's days, though it can keep its own.
      const back = await call('PATCH', `/api/vehicles/v1/trips/${running.id}`, { endDate: null });
      expect(back.statusCode).toBe(409);
      const renamed = await call('PATCH', `/api/vehicles/v1/trips/${running.id}`, { name: 'Away' });
      expect(renamed.statusCode).toBe(200);
    });
  });
});
