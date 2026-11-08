/**
 * Integration tests against a real Postgres. Skipped unless
 * TEST_DATABASE_URL points at a disposable database (tables are truncated).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, runMigrations } from '../db/client.js';
import { drives, locationPoints, vehicles } from '../db/schema.js';
import type { VehicleState } from '../rivian/types.js';
import { LocationWriter } from './location-writer.js';

const url = process.env.TEST_DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));

describe.skipIf(!url)('LocationWriter with Postgres', () => {
  let handle: ReturnType<typeof createDb>;
  let clock = 0;

  /** A fix at `fix`, with speed/altitude stamped at `readings` (default: with the fix). */
  const state = (fix: string, lat: number, readings = fix): VehicleState => ({
    gnssLocation: { latitude: lat, longitude: -116.05, timeStamp: fix },
    gnssSpeed: { value: 20, timeStamp: readings },
    gnssAltitude: { value: 600, timeStamp: readings },
  });
  const points = () => handle.db.select().from(locationPoints).orderBy(locationPoints.ts);

  /** A navigation frame's fix: a position, its time, and the speed it read there. */
  const nav = (fix: string, lat: number, speedMps = 10) => ({
    navLocation: { latitude: lat, longitude: -116.05, timeStamp: fix, speedMps, bearing: 90 },
  });

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

  it('files a fix delivered late under the drive it was taken on', async () => {
    const [earlier] = await handle.db
      .insert(drives)
      .values({
        vehicleId: 'v1',
        startedAt: new Date('2026-10-04T16:16:00Z'),
        endedAt: new Date('2026-10-04T16:42:42Z'),
      })
      .returning();
    const [current] = await handle.db
      .insert(drives)
      .values({ vehicleId: 'v1', startedAt: new Date('2026-10-04T16:51:21Z') })
      .returning();
    const writer = new LocationWriter(handle.db, () => clock);
    writer.setCurrentDrive('v1', current!.id);

    clock = Date.parse('2026-10-04T17:09:00Z');
    await writer.onState('v1', state('2026-10-04T16:30:00Z', 34.01)); // from the earlier drive
    await writer.onState('v1', state('2026-10-04T16:45:37Z', 34.02)); // parked in between
    await writer.onState('v1', state('2026-10-04T17:08:59Z', 34.03)); // live

    expect((await points()).map((p) => p.driveId)).toEqual([earlier!.id, null, current!.id]);
  });

  it('keeps speed and altitude only when stamped with the fix', async () => {
    const writer = new LocationWriter(handle.db, () => clock);
    clock = Date.parse('2026-10-04T17:09:00Z');
    await writer.onState('v1', state('2026-10-04T16:30:00Z', 34.01, '2026-10-04T17:08:50Z'));
    await writer.onState('v1', state('2026-10-04T17:08:59Z', 34.03));

    const [late, live] = await points();
    expect([late!.speedKmh, late!.altitude]).toEqual([null, null]);
    expect([live!.speedKmh, live!.altitude]).toEqual([72, 600]);
  });

  it("stores Rivian's last fix once, even when a restart sees it again", async () => {
    clock = Date.parse('2026-10-04T10:16:00Z');
    await new LocationWriter(handle.db, () => clock).onState(
      'v1',
      state('2026-10-03T21:37:03Z', 34.0),
    );
    await new LocationWriter(handle.db, () => clock).onState(
      'v1',
      state('2026-10-03T21:37:03Z', 34.0),
    );
    expect(await points()).toHaveLength(1);
  });

  it('ignores the 0,0 Rivian sends without a fix', async () => {
    clock = Date.parse('2026-10-04T17:09:00Z');
    await new LocationWriter(handle.db, () => clock).onState('v1', {
      gnssLocation: { latitude: 0, longitude: 0, timeStamp: '2026-10-04T17:08:59Z' },
    });
    expect(await points()).toHaveLength(0);
  });

  it('stores a fix re-sent under a newer stamp once, even with a new speed', async () => {
    const writer = new LocationWriter(handle.db, () => clock);
    clock = Date.parse('2026-10-04T17:09:00Z');
    await writer.onState('v1', state('2026-10-04T17:08:00Z', 34.01));
    await writer.onState('v1', state('2026-10-04T17:08:40Z', 34.01));
    await writer.onState('v1', {
      ...state('2026-10-04T17:08:50Z', 34.01),
      gnssSpeed: { value: 3, timeStamp: '2026-10-04T17:08:50Z' },
    });
    expect(await points()).toHaveLength(1);
  });

  it('still stores a short move at speed', async () => {
    const writer = new LocationWriter(handle.db, () => clock);
    clock = Date.parse('2026-10-04T17:09:00Z');
    await writer.onState('v1', state('2026-10-04T17:08:00Z', 34.01));
    await writer.onState('v1', state('2026-10-04T17:08:05Z', 34.01001)); // ~1 m on
    expect(await points()).toHaveLength(2);
  });

  it('stores a short move once its speed arrives in a later delta', async () => {
    const writer = new LocationWriter(handle.db, () => clock);
    clock = Date.parse('2026-10-04T17:09:00Z');
    await writer.onState('v1', state('2026-10-04T17:08:00Z', 34.01));
    const moved = { latitude: 34.01001, longitude: -116.05, timeStamp: '2026-10-04T17:08:05Z' };
    await writer.onState('v1', { gnssLocation: moved });
    expect(await points()).toHaveLength(1);
    await writer.onState('v1', {
      gnssLocation: moved,
      gnssSpeed: { value: 3, timeStamp: '2026-10-04T17:08:05Z' },
    });
    expect(await points()).toHaveLength(2);
  });

  it('stores the navigation fix while navigating, in place of the GNSS one', async () => {
    const writer = new LocationWriter(handle.db, () => clock);
    clock = Date.parse('2026-10-04T17:09:00Z');
    // Both in one state: the GNSS fix a minute behind, the navigation one current.
    await writer.onState('v1', {
      ...state('2026-10-04T17:08:59Z', 34.01),
      ...nav('2026-10-04T17:08:59.500Z', 34.0105),
    });

    const [point] = await points();
    expect([point!.lat, point!.ts.toISOString()]).toEqual([34.0105, '2026-10-04T17:08:59.500Z']);
    // Its own speed and heading, not the GNSS readings stamped with the other fix;
    // height has no navigation source, so it comes from the GNSS fix beside it.
    expect([point!.speedKmh, point!.bearing, point!.altitude]).toEqual([36, 90, 600]);
  });

  it('stores one row per navigation fix, ignoring the GNSS ones meanwhile', async () => {
    const writer = new LocationWriter(handle.db, () => clock);
    clock = Date.parse('2026-10-04T17:09:00Z');
    await writer.onState('v1', {
      ...state('2026-10-04T17:08:00Z', 34.01),
      ...nav('2026-10-04T17:08:01Z', 34.0105),
    });
    await writer.onState('v1', {
      ...state('2026-10-04T17:08:40Z', 34.02),
      ...nav('2026-10-04T17:08:41Z', 34.011),
    });
    await writer.onState('v1', {
      ...state('2026-10-04T17:08:50Z', 34.03),
      ...nav('2026-10-04T17:08:51Z', 34.02),
    });

    expect((await points()).map((p) => p.ts.toISOString())).toEqual([
      '2026-10-04T17:08:01.000Z',
      '2026-10-04T17:08:41.000Z',
      '2026-10-04T17:08:51.000Z',
    ]);
  });

  it('goes back to the navigation fix once it comes back', async () => {
    const writer = new LocationWriter(handle.db, () => clock);
    // Navigating: the navigation fix.
    clock = Date.parse('2026-10-04T17:08:05Z');
    await writer.onState('v1', {
      ...state('2026-10-04T17:08:00Z', 34.0),
      ...nav('2026-10-04T17:08:05Z', 34.01),
    });
    // The route ended: the navigation fix is two minutes old, so GNSS is back.
    clock = Date.parse('2026-10-04T17:10:00Z');
    await writer.onState('v1', {
      ...state('2026-10-04T17:09:59Z', 34.02),
      ...nav('2026-10-04T17:08:05Z', 34.01),
    });
    // A new route: the navigation fix wins again.
    clock = Date.parse('2026-10-04T17:10:10Z');
    await writer.onState('v1', {
      ...state('2026-10-04T17:10:09Z', 34.03),
      ...nav('2026-10-04T17:10:09.500Z', 34.04),
    });

    expect((await points()).map((p) => [p.ts.toISOString(), p.lat])).toEqual([
      ['2026-10-04T17:08:05.000Z', 34.01],
      ['2026-10-04T17:09:59.000Z', 34.02],
      ['2026-10-04T17:10:09.500Z', 34.04],
    ]);
  });

  it('hands back to GNSS once the last navigation fix is more than 15 s old', async () => {
    const writer = new LocationWriter(handle.db, () => clock);
    clock = Date.parse('2026-10-04T17:08:31Z');
    await writer.onState('v1', nav('2026-10-04T17:08:00Z', 34.01));
    // The route ended a moment ago: GNSS takes over by its own time, not the clock's.
    await writer.onState('v1', {
      ...state('2026-10-04T17:08:15Z', 34.02),
      ...nav('2026-10-04T17:08:00Z', 34.01),
    });
    await writer.onState('v1', {
      ...state('2026-10-04T17:08:15.001Z', 34.03),
      ...nav('2026-10-04T17:08:00Z', 34.01),
    });

    expect((await points()).map((p) => [p.lat, p.speedKmh])).toEqual([
      [34.01, 36],
      [34.03, 72],
    ]);
  });

  it('does not let a fix it stepped back from mute the GNSS fix after it', async () => {
    const writer = new LocationWriter(handle.db, () => clock);
    clock = Date.parse('2026-10-04T17:09:00Z');
    await writer.onState('v1', state('2026-10-04T17:08:00Z', 34.05));
    // Navigation's own stamp runs behind GNSS, so this one is refused as a step back.
    await writer.onState('v1', nav('2026-10-04T17:07:58.5Z', 34.06));
    // The next GNSS fix is the track's only point here and must still be stored.
    await writer.onState('v1', state('2026-10-04T17:08:05Z', 34.06));
    expect((await points()).map((p) => p.ts.toISOString())).toEqual([
      '2026-10-04T17:08:00.000Z',
      '2026-10-04T17:08:05.000Z',
    ]);
  });

  it('files a navigation fix delivered late under the drive it was taken on', async () => {
    const [earlier] = await handle.db
      .insert(drives)
      .values({
        vehicleId: 'v1',
        startedAt: new Date('2026-10-04T16:16:00Z'),
        endedAt: new Date('2026-10-04T16:42:42Z'),
      })
      .returning();
    const writer = new LocationWriter(handle.db, () => clock);
    clock = Date.parse('2026-10-04T17:09:00Z');
    await writer.onState('v1', state('2026-10-04T17:08:00Z', 34.05));
    await writer.onState('v1', nav('2026-10-04T16:30:00Z', 34.01));
    // The late fix isn't where the vehicle is now: the next move is measured from the live one.
    await writer.onState('v1', state('2026-10-04T17:08:55Z', 34.05));

    expect((await points()).map((p) => [p.ts.toISOString(), p.driveId])).toEqual([
      ['2026-10-04T16:30:00.000Z', earlier!.id],
      ['2026-10-04T17:08:00.000Z', null],
    ]);
  });

  it('stores a navigation fix once, even when a restart sees it again', async () => {
    clock = Date.parse('2026-10-04T17:09:00Z');
    await new LocationWriter(handle.db, () => clock).onState(
      'v1',
      nav('2026-10-03T21:37:03Z', 34.0),
    );
    await new LocationWriter(handle.db, () => clock).onState(
      'v1',
      nav('2026-10-03T21:37:03Z', 34.0),
    );
    expect(await points()).toHaveLength(1);
  });
});
