/**
 * Integration tests against a real Postgres. Skipped unless
 * TEST_DATABASE_URL points at a disposable database (tables are truncated).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, runMigrations } from '../db/client.js';
import { parallaxLatest, vehicles } from '../db/schema.js';
import {
  RVM_BATTERY_STATE,
  RVM_NETWORK,
  RVM_PARKED_ENERGY,
  RVM_TRIP_INFO,
  RVM_TRIP_PROGRESS,
  chargingTimeWindow,
} from '../rivian/parallax/index.js';
import { b64, double, float, int, message, string } from '../testing/protobuf.js';
import { ParallaxStore } from './parallax-store.js';

const url = process.env.TEST_DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));

describe.skipIf(!url)('ParallaxStore with Postgres', () => {
  let handle: ReturnType<typeof createDb>;
  const at = Date.parse('2026-10-01T13:40:00Z');
  const battery = (soc: number, temps?: [number, number, number]) => ({
    rvm: RVM_BATTERY_STATE,
    timestamp: at,
    payload: b64([
      ...message(1, [...double(1, soc), ...double(2, 111.285)]),
      ...(temps
        ? message(2, [...float(1, temps[0]), ...float(2, temps[1]), ...float(3, temps[2])])
        : []),
    ]),
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

  it('reads back a topic’s latest message, decoded', async () => {
    const store = new ParallaxStore(handle.db);
    expect(await store.latest('v1', chargingTimeWindow)).toBeNull();
    const window = (day: number) => ({
      rvm: chargingTimeWindow.rvm,
      timestamp: at,
      payload: b64(message(2, [...int(2, 360), ...int(6, day), ...int(7, day)])),
    });
    await store.ingest('v1', window(2));
    await store.ingest('v1', window(3));
    expect(await store.latest('v1', chargingTimeWindow)).toEqual({
      value: expect.objectContaining({ startDay: 3, endMinute: 360 }),
      at: new Date(at),
    });
  });

  it('keeps the last awake cell temperatures after the vehicle sleeps', async () => {
    const store = new ParallaxStore(handle.db);
    await store.ingest('v1', battery(60, [30, 33, 28]));
    await store.ingest('v1', battery(59.5)); // asleep: no temperatures

    const insights = await store.insights('v1');
    expect(insights.cellTemps).toEqual({
      avgC: 30,
      maxC: 33,
      minC: 28,
      at: new Date(at).toISOString(),
    });
    expect(insights.cellTempsCurrent).toBe(false);
  });

  it("decodes stored topics and ignores ones it doesn't keep", async () => {
    const store = new ParallaxStore(handle.db);
    await store.ingest('v1', {
      rvm: RVM_PARKED_ENERGY,
      timestamp: null,
      payload: b64(message(1, [...float(1, 1.1), ...float(6, 5.3), ...int(11, 1440)])),
    });
    await store.ingest('v1', {
      rvm: RVM_NETWORK,
      timestamp: at / 1000, // seconds
      payload: b64(message(5, [...string(1, 'AT&T'), ...string(2, 'LTE')])),
    });
    await store.ingest('v1', { rvm: 'body.locks.states', timestamp: null, payload: 'CAE=' });

    const insights = await store.insights('v1');
    expect(insights.parkedEnergy?.windows).toEqual([
      {
        minutes: 1440,
        kwh: expect.closeTo(1.1),
        rangeKm: expect.closeTo(5.3),
        uses: { climate: 0, system: 0, gearGuard: 0, outlets: 0 },
      },
    ]);
    expect(insights.connectivity).toEqual({
      wifi: null,
      cellular: { carrier: 'AT&T', technology: 'LTE' },
      at: new Date(at).toISOString(),
    });
    expect(insights.coldWeather).toBeNull();
    const rows = await handle.db.select({ rvm: parallaxLatest.rvm }).from(parallaxLatest);
    expect(rows.map((r) => r.rvm).sort()).toEqual([RVM_PARKED_ENERGY, RVM_NETWORK]);
  });

  it("shows navigation's arrival and route, with progress's ETA once it comes", async () => {
    const store = new ParallaxStore(handle.db);
    const planned = 1792020295;
    await store.ingest('v1', {
      rvm: RVM_TRIP_INFO,
      timestamp: at,
      payload: b64([
        ...message(3, [
          ...double(1, 24400),
          ...double(2, 2114),
          ...message(
            3,
            message(1, [
              ...message(1, [...double(1, 33.07587), ...double(2, -117.2599)]),
              ...message(9, int(1, planned)),
            ]),
          ),
          ...double(6, 57.48),
          ...double(7, 308577),
          ...string(10, '_p~iF~ps|U_ulLnnqC'),
        ]),
      ]),
    });
    expect((await store.insights('v1')).navigation).toMatchObject({
      arrivalSoc: 57.48,
      arrivalRangeKm: 308.577,
      etaAt: new Date(planned * 1000).toISOString(),
      route: [
        [38.5, -120.2],
        [40.7, -120.95],
      ],
    });
    expect((await store.insights('v1')).navigation).not.toHaveProperty('arrivalAtMs');

    await store.ingest('v1', {
      rvm: RVM_TRIP_PROGRESS,
      timestamp: at,
      payload: b64([...message(1, int(1, planned + 60)), ...double(4, 20000)]),
    });
    expect((await store.insights('v1')).navigation).toMatchObject({
      etaAt: new Date((planned + 60) * 1000).toISOString(),
      remainingKm: 20,
    });
  });
});
