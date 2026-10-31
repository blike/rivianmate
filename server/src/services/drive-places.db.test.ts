/**
 * Integration tests against a real Postgres. Skipped unless
 * TEST_DATABASE_URL points at a disposable database (tables are truncated).
 */
import { eq } from 'drizzle-orm';
import { silentLogger } from '../logger.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, runMigrations } from '../db/client.js';
import { chargingSessions, drives, geocodeCache, savedLocations, vehicles } from '../db/schema.js';
import { DrivePlaces, type ReverseGeocode } from './drive-places.js';

const url = process.env.TEST_DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));

describe.skipIf(!url)('DrivePlaces with Postgres', () => {
  let handle: ReturnType<typeof createDb>;
  const drive = (startLat: number, endLat: number, ended = true) =>
    handle.db
      .insert(drives)
      .values({
        vehicleId: 'v1',
        startedAt: new Date('2026-10-01T15:00:00Z'),
        endedAt: ended ? new Date('2026-10-01T15:20:00Z') : null,
        startLat,
        startLon: -117,
        endLat,
        endLon: -117,
      })
      .returning()
      .then((r) => r[0]!.id);
  const row = async (id: number) =>
    (await handle.db.select().from(drives)).find((d) => d.id === id)!;

  beforeAll(async () => {
    await runMigrations(url!, join(here, '..', '..', 'drizzle'));
    handle = createDb(url!);
  });
  afterAll(async () => {
    await handle.sql.end();
  });
  beforeEach(async () => {
    await handle.sql`TRUNCATE vehicles, geocode_cache, saved_locations RESTART IDENTITY CASCADE`;
    await handle.db.insert(vehicles).values({ id: 'v1', vin: 'VIN1' });
  });

  const importedCharge = (lat: number, more = {}) =>
    handle.db
      .insert(chargingSessions)
      .values({
        vehicleId: 'v1',
        source: 'electrafi',
        startedAt: new Date('2026-10-01T15:00:00Z'),
        endedAt: new Date('2026-10-01T16:00:00Z'),
        lat,
        lon: -97,
        ...more,
      })
      .returning()
      .then((r) => r[0]!.id);
  const session = async (id: number) =>
    (await handle.db.select().from(chargingSessions)).find((s) => s.id === id)!;
  const found: ReverseGeocode = async (lat) => ({
    place: `Street ${lat}`,
    address: `Full ${lat}`,
    area: 'Austin, TX',
  });

  it('names an imported charge by its town', async () => {
    const id = await importedCharge(30);
    const places = new DrivePlaces(handle.db, found, silentLogger, 0);
    await places.start();
    await places.idle();
    const row = await session(id);
    expect(row.city).toBe('Austin, TX');
    expect(row.placesCheckedAt).not.toBeNull();
  });

  it("doesn't send a charge at a saved location, or one with a name", async () => {
    await handle.db.insert(savedLocations).values({ name: 'Home', lat: 30, lon: -97 });
    const atHome = await importedCharge(30);
    const named = await importedCharge(31, { vendor: 'CHARGEPOINT' });
    const live = await importedCharge(32, { source: 'live' });
    const calls: number[] = [];
    const places = new DrivePlaces(
      handle.db,
      async (lat) => {
        calls.push(lat);
        return null;
      },
      silentLogger,
      0,
    );
    await places.start();
    await places.idle();
    expect(calls).toEqual([]);
    expect((await session(atHome)).placesCheckedAt).toBeNull();
    expect((await session(named)).placesCheckedAt).toBeNull();
    expect((await session(live)).placesCheckedAt).toBeNull();
  });

  it('looks up again a spot cached before towns were kept, keeping its other figures', async () => {
    await handle.db
      .insert(geocodeCache)
      .values({ key: '30.0000,-97.0000', place: 'Old street', address: 'Old full' });
    const id = await importedCharge(30);
    const places = new DrivePlaces(handle.db, found, silentLogger, 0);
    await places.start();
    await places.idle();
    expect((await session(id)).city).toBe('Austin, TX');
    const [cached] = await handle.db.select().from(geocodeCache);
    expect(cached).toMatchObject({ place: 'Old street', area: 'Austin, TX' });
  });

  it('sends nothing for charges while lookups are off, and catches up when on', async () => {
    const id = await importedCharge(30);
    const calls: number[] = [];
    const places = new DrivePlaces(
      handle.db,
      async (lat) => {
        calls.push(lat);
        return { place: 'S', address: 'F', area: 'Austin, TX' };
      },
      silentLogger,
      0,
    );
    places.setEnabled(false);
    await places.start();
    await places.idle();
    expect(calls).toEqual([]);
    places.setEnabled(true);
    await vi.waitFor(async () => expect((await session(id)).city).toBe('Austin, TX'));
  });

  it('leaves a charge pending when the lookup fails', async () => {
    const id = await importedCharge(30);
    const places = new DrivePlaces(
      handle.db,
      async () => {
        throw new Error('Nominatim HTTP 500');
      },
      silentLogger,
      0,
    );
    await places.start();
    await places.idle();
    expect((await session(id)).placesCheckedAt).toBeNull();
  });

  it('fills finished drives, looking each spot up once', async () => {
    const calls: number[] = [];
    const geocode: ReverseGeocode = async (lat) => {
      calls.push(lat);
      return lat === 34 ? null : { place: `Place ${lat}`, address: `Full ${lat}` };
    };
    const first = await drive(33, 34);
    const second = await drive(34, 33); // the same two spots, reversed
    const ongoing = await drive(35, 36, false);
    const places = new DrivePlaces(handle.db, geocode, silentLogger, 0);
    await places.start();
    await places.idle();

    expect(calls.sort()).toEqual([33, 34]);
    const a = await row(first);
    expect([a.startPlace, a.startAddress, a.endPlace]).toEqual(['Place 33', 'Full 33', null]);
    expect(a.placesCheckedAt).not.toBeNull();
    expect((await row(second)).endPlace).toBe('Place 33');
    expect((await row(ongoing)).placesCheckedAt).toBeNull();
  });

  it('names the start of a drive in progress, then the rest once it ends', async () => {
    const calls: number[] = [];
    const geocode: ReverseGeocode = async (lat) => {
      calls.push(lat);
      return { place: `Place ${lat}`, address: `Full ${lat}` };
    };
    const id = await drive(33, 34, false);
    const places = new DrivePlaces(handle.db, geocode, silentLogger, 0);
    places.enqueue(id);
    await places.idle();
    let r = await row(id);
    expect([r.startPlace, r.endPlace, r.placesCheckedAt]).toEqual(['Place 33', null, null]);

    await handle.db
      .update(drives)
      .set({ endedAt: new Date('2026-10-01T15:20:00Z') })
      .where(eq(drives.id, id));
    places.enqueue(id);
    await places.idle();
    r = await row(id);
    expect([r.startPlace, r.endPlace]).toEqual(['Place 33', 'Place 34']);
    expect(calls).toEqual([33, 34]); // the start came from cache
  });

  it('leaves a drive pending when the lookup service fails', async () => {
    const id = await drive(33, 34);
    const places = new DrivePlaces(
      handle.db,
      async () => {
        throw new Error('Nominatim HTTP 503');
      },
      silentLogger,
      0,
    );
    places.enqueue(id);
    await places.idle();
    expect((await row(id)).placesCheckedAt).toBeNull();
  });

  it('sends nothing while turned off, and catches up once turned back on', async () => {
    const calls: number[] = [];
    const geocode: ReverseGeocode = async (lat) => {
      calls.push(lat);
      return { place: `Place ${lat}`, address: null };
    };
    const id = await drive(33, 34);
    const places = new DrivePlaces(handle.db, geocode, silentLogger, 0);
    places.setEnabled(false);
    await places.start();
    places.enqueue(id);
    await places.idle();
    expect(calls).toEqual([]);
    expect((await row(id)).placesCheckedAt).toBeNull();

    places.setEnabled(true);
    await new Promise((r) => setTimeout(r, 50)); // the backlog is listed in the background
    await places.idle();
    expect(calls).toEqual([33, 34]);
    expect((await row(id)).endPlace).toBe('Place 34');
  });

  it('stops before the next lookup when turned off mid-drive', async () => {
    const calls: number[] = [];
    const geocode: ReverseGeocode = async (lat) => {
      calls.push(lat);
      places.setEnabled(false);
      return { place: `Place ${lat}`, address: null };
    };
    const id = await drive(33, 34);
    const places = new DrivePlaces(handle.db, geocode, silentLogger, 0);
    places.enqueue(id);
    await places.idle();
    expect(calls).toEqual([33]);
    expect((await row(id)).placesCheckedAt).toBeNull();
  });
});
