/**
 * Integration tests against a real Postgres. Skipped unless
 * TEST_DATABASE_URL points at a disposable database (tables are truncated).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, runMigrations } from '../db/client.js';
import {
  appSettings,
  chargingCurvePoints,
  chargingSessions,
  parallaxArchive,
  stateChanges,
  tripActivities,
  trips,
  vehicles,
} from '../db/schema.js';
import { silentLogger } from '../logger.js';
import { RVM_CHARGE_BREAKDOWN } from '../rivian/parallax/domains/energy.js';
import { b64, float, int } from '../testing/protobuf.js';
import { SPLIT_KEY, SPLIT_LOG_KEY, splitPluginCharges } from './charge-split-backfill.js';
import { HistoryKeys } from './history-keys.js';
import { ParallaxArchive } from './parallax-archive.js';
import { changeRows } from './state-history.js';

vi.setConfig({ testTimeout: 20_000 });

const url = process.env.TEST_DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));

describe.skipIf(!url)('splitting plug-ins into charges with Postgres', () => {
  let handle: ReturnType<typeof createDb>;
  let keys: HistoryKeys;
  let archive: ParallaxArchive;
  const NOW = new Date('2026-11-01T00:00:00Z');
  const CONNECTED = 'chrgr_sts_connected_no_chrg';

  /** Recorded charger state: `[time, chargerStatus, chargerState, battery level]`. */
  async function history(readings: [string, string, string, number][]) {
    const changes = readings.flatMap(([iso, status, state, soc]) => {
      const at = Date.parse(iso);
      return [
        { field: 'chargerStatus', at, value: status },
        { field: 'chargerState', at, value: state },
        { field: 'batteryLevel', at, value: soc },
      ];
    });
    await handle.db.insert(stateChanges).values(await changeRows(keys, 1, changes));
  }

  /** An archived charge_session_breakdown. */
  async function breakdown(iso: string, kwh: number, minutes: number, km: number) {
    const topicId = (await keys.topicIds([RVM_CHARGE_BREAKDOWN])).get(RVM_CHARGE_BREAKDOWN)!;
    const payload = b64([
      ...float(1, kwh),
      ...float(2, kwh - 0.5),
      ...float(5, 0.5),
      ...int(6, minutes),
      ...int(8, km),
    ]);
    await handle.db.insert(parallaxArchive).values({
      vehicleSeq: 1,
      topicId,
      at: new Date(iso),
      payload: Buffer.from(payload, 'base64'),
    });
  }

  /** A plug-in recorded as one session: charged 07:00–11:00, then again 12:00–12:15. */
  async function plugIn(over: Partial<typeof chargingSessions.$inferInsert> = {}) {
    const [row] = await handle.db
      .insert(chargingSessions)
      .values({
        vehicleId: 'v1',
        startedAt: new Date('2026-10-01T00:30:00Z'),
        endedAt: new Date('2026-10-01T12:15:00Z'),
        chargingSeconds: 4 * 3600 + 15 * 60,
        startSoc: 40,
        endSoc: 71,
        energyKwh: 30, // only the first charge's
        rangeAddedKm: 150,
        cost: '4.00',
        rivianTransactionId: 'tx-1',
        source: 'live+rivian',
        lat: 45.5,
        lon: -122.6,
        ...over,
      })
      .returning();
    await history([
      ['2026-10-01T00:30:00Z', CONNECTED, 'charging_scheduled', 40],
      ['2026-10-01T07:00:00Z', 'chrgr_sts_connected_charging', 'charging_active', 40],
      ['2026-10-01T11:00:00Z', CONNECTED, 'charging_complete', 70],
      ['2026-10-01T12:00:00Z', 'chrgr_sts_connected_charging', 'charging_active', 70],
      ['2026-10-01T12:15:00Z', 'chrgr_sts_not_connected', 'charging_ready', 71],
    ]);
    return row!;
  }

  const split = () => splitPluginCharges({ db: handle.db, archive, log: silentLogger }, NOW);
  const sessions = () =>
    handle.db.select().from(chargingSessions).orderBy(chargingSessions.startedAt);

  beforeAll(async () => {
    await runMigrations(url!, join(here, '..', '..', 'drizzle'));
    handle = createDb(url!);
    await handle.sql`TRUNCATE state_fields RESTART IDENTITY CASCADE`;
    keys = new HistoryKeys(handle.db);
    archive = new ParallaxArchive(handle.db, keys, silentLogger);
  });
  afterAll(async () => {
    await handle.sql.end();
  });
  beforeEach(async () => {
    await handle.sql`TRUNCATE vehicles, trips, charging_sessions RESTART IDENTITY CASCADE`;
    await handle.sql`TRUNCATE app_settings`;
    await handle.db.insert(vehicles).values({ id: 'v1', vin: 'VIN1' });
  });

  it('splits a plug-in that charged twice into two sessions, each with its own figures', async () => {
    const original = await plugIn();
    await breakdown('2026-10-01T11:00:00Z', 30, 240, 150);
    await breakdown('2026-10-01T12:15:00Z', 3, 15, 10);
    await handle.db.insert(chargingCurvePoints).values([
      { sessionId: original.id, ts: new Date('2026-10-01T08:00:00Z'), powerKw: 11 },
      { sessionId: original.id, ts: new Date('2026-10-01T12:05:00Z'), powerKw: 7 },
    ]);
    const [trip] = await handle.db.insert(trips).values({ vehicleId: 'v1', name: 'A' }).returning();
    await handle.db
      .insert(tripActivities)
      .values({ tripId: trip!.id, vehicleId: 'v1', kind: 'charge', activityId: original.id });

    expect(await split()).toEqual({ sessions: 1, added: 1 });

    const [first, second] = await sessions();
    expect(first!.id).toBe(original.id);
    expect([first!.startedAt, first!.endedAt].map((d) => d?.toISOString())).toEqual([
      '2026-10-01T07:00:00.000Z',
      '2026-10-01T11:00:00.000Z',
    ]);
    expect([second!.startedAt, second!.endedAt].map((d) => d?.toISOString())).toEqual([
      '2026-10-01T12:00:00.000Z',
      '2026-10-01T12:15:00.000Z',
    ]);
    expect([first!.chargingSeconds, second!.chargingSeconds]).toEqual([4 * 3600, 15 * 60]);
    expect([first!.energyKwh, second!.energyKwh]).toEqual([30, 3]);
    expect([first!.rangeAddedKm, second!.rangeAddedKm]).toEqual([150, 10]);
    expect([first!.startSoc, first!.endSoc, second!.startSoc, second!.endSoc]).toEqual([
      40, 70, 70, 71,
    ]);
    // Rivian's billed $4.00, shared by energy, to the cent.
    expect([first!.cost, second!.cost]).toEqual(['3.64', '0.36']);
    // The Rivian link stays where it was; the place comes along.
    expect([first!.rivianTransactionId, second!.rivianTransactionId]).toEqual(['tx-1', null]);
    expect([second!.source, second!.lat]).toEqual(['live+rivian', 45.5]);
    expect([first!.maxPowerKw, second!.maxPowerKw]).toEqual([11, 7]);

    const points = await handle.db.select().from(chargingCurvePoints);
    expect(points.find((p) => p.powerKw === 7)!.sessionId).toBe(second!.id);
    const inTrip = await handle.db.select().from(tripActivities);
    expect(inTrip.map((a) => a.activityId).sort()).toEqual([first!.id, second!.id].sort());

    const [log] = await handle.db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, SPLIT_LOG_KEY));
    const splits = JSON.parse(log!.value) as { session: { id: number }; added: number[] }[];
    expect(splits).toEqual([
      expect.objectContaining({
        session: expect.objectContaining({ id: original.id }),
        added: [second!.id],
      }),
    ]);
  });

  it('shares a cost the owner entered by energy, and keeps it theirs', async () => {
    await plugIn({ cost: '10.00', costEdited: true });
    await breakdown('2026-10-01T11:00:00Z', 30, 240, 150);
    await breakdown('2026-10-01T12:15:00Z', 10, 15, 50);
    await split();

    const rows = await sessions();
    expect(rows.map((r) => [r.cost, r.costEdited])).toEqual([
      ['7.50', true],
      ['2.50', true],
    ]);
  });

  it('shares the session by battery gained when no breakdowns were archived', async () => {
    await plugIn();
    await split();

    const rows = await sessions();
    // 30 kWh over +30% and +1%.
    expect(rows.map((r) => r.energyKwh)).toEqual([
      expect.closeTo(30 * (30 / 31)),
      expect.closeTo(30 * (1 / 31)),
    ]);
  });

  it('leaves imported sessions and sessions of one charge as they are, then is done', async () => {
    await plugIn({ source: 'rivian' });
    await handle.db.insert(chargingSessions).values({
      vehicleId: 'v1',
      startedAt: new Date('2026-10-02T07:00:00Z'),
      endedAt: new Date('2026-10-02T08:00:00Z'),
      chargingSeconds: 3600,
    });
    expect(await split()).toEqual({ sessions: 0, added: 0 });
    expect(await sessions()).toHaveLength(2);

    const [progress] = await handle.db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, SPLIT_KEY));
    expect(JSON.parse(progress!.value)).toEqual({ done: true });
    expect(await split()).toBeNull();
  });
});
