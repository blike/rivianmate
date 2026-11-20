/**
 * Integration tests against a real Postgres. Skipped unless
 * TEST_DATABASE_URL points at a disposable database (tables are truncated).
 */
import { fileURLToPath } from 'node:url';
import { silentLogger } from '../logger.js';
import { dirname, join } from 'node:path';
import { and, eq, ne } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, runMigrations } from '../db/client.js';
import {
  chargingCurvePoints,
  chargingSessions,
  parallaxLatest,
  tripActivities,
  trips,
  vehicles,
} from '../db/schema.js';
import type { RivianApi } from '../rivian/client.js';
import type { LiveSessionData, VehicleState } from '../rivian/types.js';
import {
  RVM_CHARGE_BREAKDOWN,
  RVM_CHARGING_GRAPH,
  RVM_SOC_SLIDER,
  RVM_TIME_ESTIMATION,
} from '../rivian/parallax/index.js';
import { b64, chargingGraph, float, graphBar, int, message, string } from '../testing/protobuf.js';
import { ChargingMonitor } from './charging-monitor.js';
import { LiveBus } from './live-bus.js';

const url = process.env.TEST_DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));

describe.skipIf(!url)('ChargingMonitor with Postgres', () => {
  let handle: ReturnType<typeof createDb>;
  const NOW = Date.parse('2026-10-01T12:00:00Z');
  const api = { getRegisteredWallboxes: async () => [] } as unknown as RivianApi;
  let clock = NOW;

  const monitor = (bus = new LiveBus()) => {
    const m = new ChargingMonitor(handle.db, api, bus, silentLogger, () => clock);
    m.setVehicles(['v1']);
    return m;
  };
  /** Vehicle state as the monitor sees it, stamped by Rivian at `at`. */
  const vehicle = (
    status: string,
    chargerState: string,
    soc: number,
    at: string,
  ): VehicleState => ({
    chargerStatus: { value: status, timeStamp: at },
    chargerState: { value: chargerState, timeStamp: at },
    batteryLevel: { value: soc, timeStamp: at },
  });
  /** Feed a state at time `at` and wait for it to be stored. */
  async function note(
    m: ChargingMonitor,
    at: string,
    status: string,
    chargerState: string,
    soc: number,
  ) {
    clock = Date.parse(at);
    m.noteState('v1', vehicle(status, chargerState, soc, at));
    await m.ingest('v1', null); // queued after the state: drains it
  }
  const PLUGGED = 'chrgr_sts_connected_no_chrg';
  const CHARGING = 'chrgr_sts_connected_charging';
  const UNPLUGGED = 'chrgr_sts_not_connected';
  /** Smart Charging holding a charge: a pause inside it, not its end. */
  const PAUSED = 'charging_smart_charging_paused';
  const live = (startTime: string, power = 10, soc = 50): LiveSessionData =>
    ({
      startTime,
      power: { value: power, updatedAt: new Date(NOW).toISOString() },
      soc: { value: soc, updatedAt: new Date(NOW).toISOString() },
      vehicleChargerState: { value: 'charging_active', updatedAt: new Date(NOW).toISOString() },
    }) as LiveSessionData;

  async function leftover(startedAt: string, samples: [string, number][]) {
    const [row] = await handle.db
      .insert(chargingSessions)
      .values({ vehicleId: 'v1', startedAt: new Date(startedAt) })
      .returning();
    if (samples.length) {
      await handle.db
        .insert(chargingCurvePoints)
        .values(samples.map(([ts, kw]) => ({ sessionId: row!.id, ts: new Date(ts), powerKw: kw })));
    }
    return row!.id;
  }
  const sessions = () => handle.db.select().from(chargingSessions).orderBy(chargingSessions.id);

  beforeAll(async () => {
    await runMigrations(url!, join(here, '..', '..', 'drizzle'));
    handle = createDb(url!);
  });
  afterAll(async () => {
    await handle.sql.end();
  });
  beforeEach(async () => {
    await handle.sql`TRUNCATE trips, charging_curve_points, charging_sessions, vehicles RESTART IDENTITY CASCADE`;
    await handle.db.insert(vehicles).values({ id: 'v1', vin: 'VIN1' });
    clock = NOW;
  });

  it('records each charge of a plug-in as its own session', async () => {
    const m = monitor();
    await m.start();
    await note(m, '2026-10-01T00:30:00Z', PLUGGED, 'charging_scheduled', 40);
    await note(m, '2026-10-01T07:00:00Z', CHARGING, 'charging_active', 40);
    await note(m, '2026-10-01T11:00:00Z', PLUGGED, 'charging_complete', 70);
    await note(m, '2026-10-01T12:00:00Z', CHARGING, 'charging_active', 70); // limit raised
    await note(m, '2026-10-01T12:15:00Z', UNPLUGGED, 'charging_ready', 71);
    m.stop();

    const rows = await sessions();
    expect(rows).toHaveLength(2);
    const [first, second] = rows;
    expect(first!.startedAt.toISOString()).toBe('2026-10-01T07:00:00.000Z');
    expect(first!.endedAt?.toISOString()).toBe('2026-10-01T11:00:00.000Z');
    expect(first!.chargingSeconds).toBe(4 * 3600);
    expect([first!.startSoc, first!.endSoc]).toEqual([40, 70]);
    expect(second!.startedAt.toISOString()).toBe('2026-10-01T12:00:00.000Z');
    expect(second!.endedAt?.toISOString()).toBe('2026-10-01T12:15:00.000Z');
    expect(second!.chargingSeconds).toBe(15 * 60);
    expect(second!.chargingSince).toBeNull();
    expect([second!.startSoc, second!.endSoc]).toEqual([70, 71]);
  });

  it('keeps a paused charge in one session', async () => {
    const m = monitor();
    await m.start();
    await note(m, '2026-10-01T07:00:00Z', CHARGING, 'charging_active', 40);
    await note(m, '2026-10-01T08:00:00Z', PLUGGED, PAUSED, 50);
    await note(m, '2026-10-01T09:00:00Z', CHARGING, 'charging_active', 50);
    await note(m, '2026-10-01T10:00:00Z', PLUGGED, 'charging_complete', 60);
    m.stop();

    const rows = await sessions();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.endedAt?.toISOString()).toBe('2026-10-01T10:00:00.000Z');
    expect(rows[0]!.chargingSeconds).toBe(2 * 3600);
  });

  it('keeps a stop that still counts time to the end in the charge', async () => {
    const m = monitor();
    await m.start();
    await note(m, '2026-10-01T07:00:00Z', CHARGING, 'charging_active', 40);
    clock = Date.parse('2026-10-01T08:00:00Z');
    m.noteState('v1', {
      ...vehicle(PLUGGED, 'charging_station_stopped', 50, '2026-10-01T08:00:00Z'),
      timeToEndOfCharge: { value: 90, timeStamp: '2026-10-01T08:00:00Z' },
    });
    await note(m, '2026-10-01T08:20:00Z', CHARGING, 'charging_active', 50);
    m.stop();

    const rows = await sessions();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.endedAt).toBeNull();
  });

  it('rejoins a charge that starts again moments after a stop that was not final', async () => {
    const m = monitor();
    await m.start();
    await note(m, '2026-10-01T07:00:00Z', CHARGING, 'charging_active', 40);
    await note(m, '2026-10-01T08:00:00Z', PLUGGED, 'charging_station_stopped', 50);
    await note(m, '2026-10-01T08:01:00Z', CHARGING, 'charging_active', 50);
    await note(m, '2026-10-01T09:00:00Z', PLUGGED, 'charging_complete', 60);
    m.stop();

    const rows = await sessions();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.endedAt?.toISOString()).toBe('2026-10-01T09:00:00.000Z');
    expect(rows[0]!.chargingSeconds).toBe(2 * 3600 - 60);
  });

  it('starts a new charge after a final stop, however soon', async () => {
    const m = monitor();
    await m.start();
    await note(m, '2026-10-01T07:00:00Z', CHARGING, 'charging_active', 40);
    await note(m, '2026-10-01T08:00:00Z', PLUGGED, 'charging_complete', 60);
    await note(m, '2026-10-01T08:01:00Z', CHARGING, 'charging_active', 60);
    m.stop();

    expect(await sessions()).toHaveLength(2);
  });

  it('ends a paused charge when charging last stopped, not at the unplug', async () => {
    const m = monitor();
    await m.start();
    await note(m, '2026-10-01T07:00:00Z', CHARGING, 'charging_active', 40);
    await note(m, '2026-10-01T08:00:00Z', PLUGGED, PAUSED, 50);
    await note(m, '2026-10-01T15:00:00Z', UNPLUGGED, 'charging_ready', 50);
    m.stop();

    const [row] = await sessions();
    expect(row!.endedAt?.toISOString()).toBe('2026-10-01T08:00:00.000Z');
    expect(row!.chargingSeconds).toBe(3600);
  });

  it('records nothing for a plug-in until it charges', async () => {
    const m = monitor();
    await m.start();
    await note(m, '2026-10-01T00:30:00Z', PLUGGED, 'charging_scheduled', 40);
    expect(await sessions()).toHaveLength(0);
    await note(m, '2026-10-01T00:31:00Z', UNPLUGGED, 'charging_ready', 40);
    await note(m, '2026-10-01T00:32:00Z', PLUGGED, 'charging_scheduled', 40);
    await note(m, '2026-10-01T07:00:00Z', CHARGING, 'charging_active', 40);
    await note(m, '2026-10-01T08:00:00Z', UNPLUGGED, 'charging_ready', 50);
    m.stop();

    const rows = await sessions();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.startedAt.toISOString()).toBe('2026-10-01T07:00:00.000Z');
    expect(rows[0]!.chargingSeconds).toBe(3600);
  });

  it('takes a discarded session out of its trip, and only that', async () => {
    const m = monitor();
    await m.start();
    await note(m, '2026-10-01T00:30:00Z', CHARGING, 'charging_active', 40);
    const [session] = await sessions();
    const [trip] = await handle.db.insert(trips).values({ vehicleId: 'v1', name: 'A' }).returning();
    const link = { tripId: trip!.id, kind: 'charge' as const, activityId: session!.id };
    // TeslaMate's ids are its own, so one of its charges can share this id.
    await handle.db.insert(tripActivities).values([
      { ...link, vehicleId: 'v1' },
      { ...link, vehicleId: 'tm-1' },
    ]);
    // Unplugged the moment it started: nothing was charged.
    await note(m, '2026-10-01T00:30:00Z', UNPLUGGED, 'charging_ready', 40);
    m.stop();

    expect(await sessions()).toHaveLength(0);
    const left = await handle.db.select().from(tripActivities);
    expect(left.map((l) => l.vehicleId)).toEqual(['tm-1']);
  });

  it('continues a plug-in across a restart, keeping its charging time', async () => {
    const before = monitor();
    await before.start();
    await note(before, '2026-10-01T07:00:00Z', CHARGING, 'charging_active', 40);
    before.stop();

    const after = monitor();
    await after.start();
    await note(after, '2026-10-01T09:00:00Z', CHARGING, 'charging_active', 55);
    await note(after, '2026-10-01T10:00:00Z', UNPLUGGED, 'charging_ready', 62);
    after.stop();

    const rows = await sessions();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.chargingSeconds).toBe(3 * 3600);
    expect([rows[0]!.startSoc, rows[0]!.endSoc]).toEqual([40, 62]);
  });

  it("stores the Parallax charging graph as the session's power curve", async () => {
    const m = monitor();
    await m.start();
    await note(m, '2026-10-01T07:00:00Z', CHARGING, 'charging_active', 40);
    const t0 = Date.parse('2026-10-01T07:00:00Z');
    const graph = (lastKw: number) => ({
      rvm: RVM_CHARGING_GRAPH,
      timestamp: null,
      payload: chargingGraph(
        graphBar(40, 11, t0, t0 + 60_000),
        graphBar(41, lastKw, t0 + 60_000, t0 + 120_000),
        graphBar(30, 50, t0 - 2 * 86_400_000, t0 - 2 * 86_400_000 + 60_000), // days old: dropped
      ),
    });
    clock = t0 + 5 * 60_000;
    await m.ingestParallax('v1', graph(9));
    await m.ingestParallax('v1', graph(10.5)); // the growing bar is re-sent
    await m.ingestParallax('v1', {
      rvm: 'charging.session.status',
      timestamp: null,
      payload: 'CAEQAQ==',
    });
    m.stop();

    const [session] = await sessions();
    const points = await handle.db
      .select()
      .from(chargingCurvePoints)
      .where(
        and(
          eq(chargingCurvePoints.sessionId, session!.id),
          eq(chargingCurvePoints.source, 'graph'),
        ),
      )
      .orderBy(chargingCurvePoints.ts);
    // Each bar's power at its start, with the level at its end on the next point.
    expect(points.map((p) => [p.ts.getTime() - t0, p.powerKw, p.soc])).toEqual([
      [0, 11, null],
      [60_000, 10.5, 40],
      [120_000, 10.5, 41],
    ]);
    expect(session!.maxPowerKw).toBe(11);
    // Per bar: the closing point doesn't count the last bar twice.
    expect(session!.avgPowerKw).toBeCloseTo(10.75);
  });

  it('replaces the curve when Rivian re-buckets the graph into longer bars', async () => {
    const m = monitor();
    await m.start();
    await note(m, '2026-10-01T07:00:00Z', CHARGING, 'charging_active', 43);
    const t0 = Date.parse('2026-10-01T07:00:00Z');
    const MIN = 60_000;
    const sendGraph = (...bars: number[][]) =>
      m.ingestParallax('v1', {
        rvm: RVM_CHARGING_GRAPH,
        timestamp: null,
        payload: chargingGraph(...bars),
      });
    clock = t0 + 64 * MIN;
    await sendGraph(
      graphBar(45, 7.3, t0, t0 + 16 * MIN),
      graphBar(47, 7.3, t0 + 16 * MIN, t0 + 32 * MIN),
      graphBar(48, 7.3, t0 + 32 * MIN, t0 + 48 * MIN),
      graphBar(50, 7.3, t0 + 48 * MIN, t0 + 64 * MIN),
    );
    clock = t0 + 65 * MIN;
    await sendGraph(
      graphBar(47, 7.3, t0, t0 + 32 * MIN),
      graphBar(50, 7.4, t0 + 32 * MIN, t0 + 64 * MIN),
    );
    m.stop();

    const [session] = await sessions();
    const points = await handle.db
      .select()
      .from(chargingCurvePoints)
      .where(
        and(
          eq(chargingCurvePoints.sessionId, session!.id),
          eq(chargingCurvePoints.source, 'graph'),
        ),
      )
      .orderBy(chargingCurvePoints.ts);
    // Only the 32-minute bars' points: none left over from the 16-minute ones.
    expect(points.map((p) => [(p.ts.getTime() - t0) / MIN, p.powerKw, p.soc])).toEqual([
      [0, 7.3, null],
      [32, 7.4, 47],
      [64, 7.4, 50],
    ]);
    expect(session!.avgPowerKw).toBeCloseTo(7.35);
  });

  it("fills a finished session's curve from the graph Rivian sends on subscribe", async () => {
    const [done] = await handle.db
      .insert(chargingSessions)
      .values({
        vehicleId: 'v1',
        startedAt: new Date('2026-10-01T00:34:54Z'),
        endedAt: new Date('2026-10-01T12:31:09Z'),
      })
      .returning();
    const at = (iso: string) => Date.parse(iso);
    const m = monitor();
    await m.start();
    await m.ingestParallax('v1', {
      rvm: RVM_CHARGING_GRAPH,
      timestamp: null,
      payload: chargingGraph(
        graphBar(40, 0, at('2026-10-01T00:35:00Z'), at('2026-10-01T01:07:00Z')),
        graphBar(43, 7.4, at('2026-10-01T07:09:00Z'), at('2026-10-01T07:41:00Z')),
        graphBar(70, 0, at('2026-10-01T11:57:00Z'), at('2026-10-01T12:29:00Z')),
      ),
    });
    m.stop();

    const points = await handle.db
      .select()
      .from(chargingCurvePoints)
      .where(eq(chargingCurvePoints.sessionId, done!.id))
      .orderBy(chargingCurvePoints.ts);
    expect(points.map((p) => p.soc)).toEqual([null, 40, 43, 70]);
    const [row] = await sessions();
    expect(row!.maxPowerKw).toBeCloseTo(7.4);
  });

  /** A charge_session_breakdown message. */
  const breakdown = (
    totalKwh: number,
    packKwh: number,
    thermalKwh: number,
    minutes: number,
    km: number,
  ) => ({
    rvm: RVM_CHARGE_BREAKDOWN,
    timestamp: null,
    payload: b64([
      ...float(1, totalKwh),
      ...float(2, packKwh),
      ...float(5, thermalKwh),
      ...int(6, minutes),
      ...int(8, km),
    ]),
  });

  it("splits a finished session's energy with the breakdown matching its charging time", async () => {
    await handle.db.insert(chargingSessions).values({
      vehicleId: 'v1',
      startedAt: new Date('2026-10-01T00:34:54Z'),
      endedAt: new Date('2026-10-01T12:31:09Z'),
      chargingSeconds: 18_779, // 5h13m
      energyKwh: 35.7, // from Rivian's history
    });
    const m = monitor();
    await m.start();
    await m.ingestParallax('v1', breakdown(35.8, 34.4, 1.4, 313, 162));
    m.stop();

    const [row] = await sessions();
    expect([row!.packKwh, row!.thermalKwh]).toEqual([expect.closeTo(34.4), expect.closeTo(1.4)]);
    expect(row!.energyKwh).toBeCloseTo(35.7);
    expect(row!.rangeAddedKm).toBe(162);
  });

  it("adds up a paused charge's stretches, whose counter starts over when charging does", async () => {
    const m = monitor();
    await m.start();
    await note(m, '2026-11-13T20:33:00Z', CHARGING, 'charging_active', 51);
    clock = Date.parse('2026-11-13T21:43:00Z');
    await m.ingestParallax('v1', breakdown(10.4, 10, 0.4, 70, 59));

    // The car stays plugged in and stops charging until the night's second run.
    await note(m, '2026-11-13T21:44:00Z', PLUGGED, PAUSED, 62);
    clock = Date.parse('2026-11-14T02:26:00Z');
    await note(m, '2026-11-14T02:26:00Z', CHARGING, 'charging_active', 63);
    clock = Date.parse('2026-11-14T03:44:00Z');
    await m.ingestParallax('v1', breakdown(26.8, 25.9, 0.9, 78, 146));
    await note(m, '2026-11-14T03:45:00Z', PLUGGED, PAUSED, 90);
    m.stop();

    const [row] = await sessions();
    expect(row!.energyKwh).toBeCloseTo(37.2);
    expect(row!.packKwh).toBeCloseTo(35.9);
    expect(row!.thermalKwh).toBeCloseTo(1.3);
    expect(row!.rangeAddedKm).toBe(205);
    // Charging time is still the session's own, across both stretches.
    expect(row!.chargingSeconds).toBe(71 * 60 + 79 * 60);
  });

  it("takes a stretch's last word when it arrives after charging stopped", async () => {
    const m = monitor();
    await m.start();
    await note(m, '2026-10-01T20:33:00Z', CHARGING, 'charging_active', 51);
    clock = Date.parse('2026-10-01T21:42:00Z');
    await m.ingestParallax('v1', breakdown(10, 9.6, 0.4, 69, 55));
    await note(m, '2026-10-01T21:43:00Z', PLUGGED, 'charging_ready', 62);
    await m.ingestParallax('v1', breakdown(10.4, 10, 0.4, 70, 59));
    m.stop();

    const [row] = await sessions();
    expect(row!.energyKwh).toBeCloseTo(10.4);
    expect(row!.rangeAddedKm).toBe(59);
  });

  it('counts a stretch once when its closing message is re-sent after the pause', async () => {
    const m = monitor();
    await m.start();
    await note(m, '2026-10-01T19:00:00Z', CHARGING, 'charging_active', 40);
    clock = Date.parse('2026-10-01T20:00:00Z');
    await m.ingestParallax('v1', breakdown(12, 11.6, 0.4, 60, 62));
    await note(m, '2026-10-01T20:01:00Z', PLUGGED, PAUSED, 62);
    await m.ingestParallax('v1', breakdown(12, 11.6, 0.4, 60, 62)); // re-sent
    clock = Date.parse('2026-10-01T23:00:00Z');
    await note(m, '2026-10-01T23:00:00Z', CHARGING, 'charging_active', 63);
    clock = Date.parse('2026-10-01T23:05:00Z');
    await m.ingestParallax('v1', breakdown(0.5, 0.5, 0, 5, 3));
    m.stop();

    const rows = await sessions();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.energyKwh).toBeCloseTo(12.5);
    expect(rows[0]!.rangeAddedKm).toBe(65);
  });

  it('leaves an older message out when a newer one has already been counted', async () => {
    const m = monitor();
    await m.start();
    await note(m, '2026-10-01T19:00:00Z', CHARGING, 'charging_active', 40);
    clock = Date.parse('2026-10-01T19:40:00Z');
    await m.ingestParallax('v1', breakdown(5, 4.8, 0.2, 40, 26));
    clock = Date.parse('2026-10-01T19:41:00Z');
    // Close enough to the elapsed time to pass the session match on its own,
    // so only the "a stretch's counter only grows" rule can turn it away.
    await m.ingestParallax('v1', breakdown(4.6, 4.4, 0.2, 38, 24));
    m.stop();

    const [row] = await sessions();
    expect(row!.energyKwh).toBeCloseTo(5);
    expect(row!.rangeAddedKm).toBe(26);
  });

  it("adds each stretch's range once, including one whose closing message has none", async () => {
    /** A breakdown with no range, as some of them are. */
    const noRange = (totalKwh: number, packKwh: number, thermalKwh: number, minutes: number) => ({
      rvm: RVM_CHARGE_BREAKDOWN,
      timestamp: null,
      payload: b64([
        ...float(1, totalKwh),
        ...float(2, packKwh),
        ...float(5, thermalKwh),
        ...int(6, minutes),
      ]),
    });
    const m = monitor();
    await m.start();
    await note(m, '2026-10-01T19:00:00Z', CHARGING, 'charging_active', 40);
    // First stretch: 12 kWh, 62 km.
    clock = Date.parse('2026-10-01T20:00:00Z');
    await m.ingestParallax('v1', breakdown(12, 11.6, 0.4, 60, 62));
    await note(m, '2026-10-01T20:01:00Z', PLUGGED, PAUSED, 62);
    // Second stretch: reports no range until its closing message.
    clock = Date.parse('2026-10-01T23:00:00Z');
    await note(m, '2026-10-01T23:00:00Z', CHARGING, 'charging_active', 63);
    clock = Date.parse('2026-10-01T23:05:00Z');
    await m.ingestParallax('v1', noRange(0.5, 0.5, 0, 5));
    await note(m, '2026-10-01T23:06:00Z', PLUGGED, PAUSED, 64);
    await m.ingestParallax('v1', breakdown(0.6, 0.6, 0, 5, 3));
    m.stop();

    const [row] = await sessions();
    expect(row!.energyKwh).toBeCloseTo(12.6);
    // 62 from the first stretch plus 3 from the second: neither lost nor doubled.
    expect(row!.rangeAddedKm).toBe(65);
  });

  it('keeps the earlier stretches when the latest one has a closing message', async () => {
    const m = monitor();
    await m.start();
    await note(m, '2026-11-13T20:33:00Z', CHARGING, 'charging_active', 51);
    clock = Date.parse('2026-11-13T21:43:00Z');
    await m.ingestParallax('v1', breakdown(10.4, 10, 0.4, 70, 59));
    await note(m, '2026-11-13T21:44:00Z', PLUGGED, PAUSED, 62);
    clock = Date.parse('2026-11-14T02:26:00Z');
    await note(m, '2026-11-14T02:26:00Z', CHARGING, 'charging_active', 63);
    clock = Date.parse('2026-11-14T05:24:00Z');
    await m.ingestParallax('v1', breakdown(26.8, 25.9, 0.9, 178, 146));
    await note(m, '2026-11-14T05:25:00Z', PLUGGED, PAUSED, 90);
    await m.ingestParallax('v1', breakdown(26.9, 26, 0.9, 178, 147)); // last word
    m.stop();

    const [row] = await sessions();
    expect(row!.energyKwh).toBeCloseTo(37.3);
    expect(row!.rangeAddedKm).toBe(59 + 147);
  });

  it('does not let a finished stretch take a message meant for a later one', async () => {
    // Rivian's counter restarts each stretch, so a later stretch that happens to
    // run as long as the last one looks the same to this guard. Only the stretch
    // that has just ended may take a closing message.
    const m = monitor();
    await m.start();
    await note(m, '2026-10-01T19:00:00Z', CHARGING, 'charging_active', 40);
    clock = Date.parse('2026-10-01T20:00:00Z');
    await m.ingestParallax('v1', breakdown(10, 9.8, 0.2, 60, 50));
    await note(m, '2026-10-01T20:01:00Z', PLUGGED, PAUSED, 52);
    // A second stretch reports nothing at all before it pauses.
    clock = Date.parse('2026-10-01T22:00:00Z');
    await note(m, '2026-10-01T22:00:00Z', CHARGING, 'charging_active', 53);
    await note(m, '2026-10-01T22:01:00Z', PLUGGED, PAUSED, 54);
    await m.ingestParallax('v1', breakdown(10.2, 10, 0.2, 60, 51));
    m.stop();

    const [row] = await sessions();
    expect(row!.energyKwh).toBeCloseTo(10);
    expect(row!.rangeAddedKm).toBe(50);
  });

  it("keeps the previous session's breakdown off a new plug-in, then tracks its own", async () => {
    const m = monitor();
    await m.start();
    await note(m, '2026-10-01T07:00:00Z', CHARGING, 'charging_active', 40);
    await m.ingestParallax('v1', breakdown(35.8, 34.4, 1.4, 313, 162)); // sent on subscribe
    let [row] = await sessions();
    expect(row!.energyKwh).toBeNull();

    clock = Date.parse('2026-10-01T08:00:00Z');
    await m.ingestParallax('v1', breakdown(7.2, 7, 0.2, 59, 33));
    m.stop();
    [row] = await sessions();
    expect([row!.energyKwh, row!.packKwh, row!.thermalKwh]).toEqual([
      expect.closeTo(7.2),
      expect.closeTo(7),
      expect.closeTo(0.2),
    ]);
    expect(row!.rangeAddedKm).toBe(33);
  });

  it("tracks Rivian's running cost while charging, leaving a cost the owner entered", async () => {
    /** A breakdown carrying the session's cost so far, in USD. */
    const costing = (minutes: number, dollars: number, cents: number) => ({
      ...breakdown(minutes * 0.2, minutes * 0.2, 0, minutes, minutes),
      payload: b64([
        ...float(1, minutes * 0.2),
        ...float(2, minutes * 0.2),
        ...int(6, minutes),
        ...message(11, [...string(1, 'USD'), ...int(2, dollars), ...int(3, cents * 10_000_000)]),
      ]),
    });
    const m = monitor();
    await m.start();
    await note(m, '2026-10-01T07:00:00Z', CHARGING, 'charging_active', 40);
    clock = Date.parse('2026-10-01T07:02:00Z');
    await m.ingestParallax('v1', costing(2, 1, 6));
    clock = Date.parse('2026-10-01T07:30:00Z');
    await m.ingestParallax('v1', costing(30, 15, 40));
    let [row] = await sessions();
    // The latest total, not the first one seen ($1.06).
    expect([row!.cost, row!.currency]).toEqual(['15.40', 'USD']);

    await handle.db.update(chargingSessions).set({ cost: '12.00', costEdited: true });
    clock = Date.parse('2026-10-01T07:45:00Z');
    await m.ingestParallax('v1', costing(45, 23, 10));
    m.stop();
    [row] = await sessions();
    expect(row!.cost).toBe('12.00');
  });

  it("adds push-feed power and energy to the plug-in's session", async () => {
    const m = monitor();
    await m.start();
    await note(m, '2026-10-01T11:00:00Z', CHARGING, 'charging_active', 50);
    await m.ingest('v1', {
      ...live('2026-10-01T11:00:00Z', 11),
      totalChargedEnergy: { value: 5 },
    } as LiveSessionData);
    m.stop();

    const rows = await sessions();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.maxPowerKw).toBe(11);
    expect(rows[0]!.energyKwh).toBe(5);
  });

  it('builds the live session from state and Parallax while the push feed is silent', async () => {
    const bus = new LiveBus();
    const m = monitor(bus);
    await m.start();
    await note(m, '2026-10-01T07:00:00Z', CHARGING, 'charging_active', 60);
    m.noteState('v1', {
      ...vehicle(CHARGING, 'charging_active', 61, '2026-10-01T07:05:00Z'),
      timeToEndOfCharge: { value: 30, timeStamp: '2026-10-01T07:05:00Z' },
    });
    const t0 = Date.parse('2026-10-01T07:00:00Z');
    await m.ingestParallax('v1', {
      rvm: RVM_CHARGING_GRAPH,
      timestamp: null,
      payload: chargingGraph(
        graphBar(60, 7.2, t0, t0 + 60_000),
        graphBar(61, 7.4, t0 + 60_000, t0 + 120_000),
      ),
    });
    await m.ingest('v1', null); // drains the queue

    const live = bus.latestChargingSession('v1');
    expect(live?.vehicleChargerState?.value).toBe('charging_active');
    expect(live?.power?.value).toBeCloseTo(7.4);
    expect(live?.soc?.value).toBe(61);
    expect(live?.timeRemaining?.value).toBe(30 * 60);

    await note(m, '2026-10-01T08:00:00Z', UNPLUGGED, 'charging_ready', 70);
    expect(bus.latestChargingSession('v1')).toBeNull();
    m.stop();
  });

  it("takes live power from the breakdown over the graph's 16-minute bars", async () => {
    const bus = new LiveBus();
    const m = monitor(bus);
    await m.start();
    await note(m, '2026-10-01T07:00:00Z', CHARGING, 'charging_active', 60);
    clock = Date.parse('2026-10-01T07:30:00Z');
    await m.ingestParallax('v1', {
      rvm: RVM_CHARGE_BREAKDOWN,
      timestamp: null,
      payload: b64([...float(1, 3.6), ...int(6, 30), ...float(9, 5.2), ...int(10, 19)]),
    });
    const t0 = Date.parse('2026-10-01T07:00:00Z');
    await m.ingestParallax('v1', {
      rvm: RVM_CHARGING_GRAPH,
      timestamp: null,
      payload: chargingGraph(graphBar(60, 7.2, t0, t0 + 16 * 60_000)),
    });
    await m.ingest('v1', null); // drains the queue

    expect(bus.latestChargingSession('v1')?.power?.value).toBeCloseTo(5.2);
    m.stop();
  });

  it('takes time left and the limit from Parallax over vehicle state', async () => {
    const bus = new LiveBus();
    const m = monitor(bus);
    await m.start();
    m.noteState('v1', {
      ...vehicle(CHARGING, 'charging_active', 90.3, '2026-10-01T07:00:00Z'),
      timeToEndOfCharge: { value: 45, timeStamp: '2026-10-01T07:00:00Z' },
    });
    await m.ingestParallax('v1', {
      rvm: RVM_TIME_ESTIMATION,
      timestamp: null,
      payload: b64(int(2, 42)),
    });
    await m.ingestParallax('v1', {
      rvm: RVM_SOC_SLIDER,
      timestamp: null,
      payload: b64(int(1, 95)),
    });
    await m.ingest('v1', null); // drains the queue
    let live = bus.latestChargingSession('v1');
    expect(live?.timeRemaining?.value).toBe(42 * 60);
    expect(live?.socLimit?.value).toBe(95);

    await m.ingestParallax('v1', { rvm: RVM_TIME_ESTIMATION, timestamp: null, payload: '' });
    await m.ingest('v1', null);
    live = bus.latestChargingSession('v1');
    expect(live?.timeRemaining).toBeNull();
    m.stop();
  });

  it('prefers an active push over the state-built session', async () => {
    const bus = new LiveBus();
    const m = monitor(bus);
    await m.start();
    await note(m, '2026-10-01T11:00:00Z', CHARGING, 'charging_active', 50);
    await m.ingest('v1', live('2026-10-01T11:00:00Z', 11));
    m.noteState('v1', vehicle(CHARGING, 'charging_active', 51, '2026-10-01T11:05:00Z'));
    await m.ingestParallax('v1', {
      rvm: 'charging.session.status',
      timestamp: null,
      payload: 'CAEQAQ==',
    });
    expect(bus.latestChargingSession('v1')?.power?.value).toBe(11);
    m.stop();
  });

  it('keeps the live power through messages that carry none and a quiet push feed (DC)', async () => {
    const bus = new LiveBus();
    const m = monitor(bus);
    await m.start();
    await note(m, '2026-10-01T11:00:00Z', CHARGING, 'charging_active', 50);
    clock = Date.parse('2026-10-01T11:10:00Z');
    await m.ingest('v1', {
      ...live('2026-10-01T11:00:00Z', 124.7, 63),
      power: { value: 124.7, updatedAt: '2026-10-01T11:10:00Z' },
    } as LiveSessionData);
    expect(bus.latestChargingSession('v1')?.power?.value).toBe(124.7);

    // A breakdown and a graph bar without power readings: unknown, not 0.
    clock = Date.parse('2026-10-01T11:10:05Z');
    await m.ingestParallax('v1', {
      rvm: RVM_CHARGE_BREAKDOWN,
      timestamp: null,
      payload: b64([...float(1, 3.6), ...int(6, 10)]),
    });
    await m.ingestParallax('v1', {
      rvm: RVM_CHARGING_GRAPH,
      timestamp: null,
      payload: chargingGraph([...int(1, 57), ...int(3, clock), ...int(6, 3)]),
    });
    await m.ingest('v1', {
      ...live('2026-10-01T11:00:00Z', 124.7, 63),
      power: { value: 124.7, updatedAt: '2026-10-01T11:10:00Z' },
    } as LiveSessionData);
    expect(bus.latestChargingSession('v1')?.power?.value).toBe(124.7);

    // The push briefly reports no session while the vehicle still charges.
    await m.ingestParallax('v1', {
      rvm: RVM_CHARGE_BREAKDOWN,
      timestamp: null,
      payload: b64([...float(1, 3.7), ...int(6, 10), ...float(9, 118)]),
    });
    await m.ingest('v1', null);
    expect(bus.latestChargingSession('v1')?.power?.value).toBe(118);
    m.stop();

    // Each source keeps its own series; the push's reading carries no SoC.
    const points = await handle.db
      .select()
      .from(chargingCurvePoints)
      .orderBy(chargingCurvePoints.ts);
    expect(
      points.filter((pt) => pt.source === 'push_live').map((pt) => [pt.powerKw, pt.soc]),
    ).toEqual([[124.7, null]]);
    expect(points.filter((pt) => pt.source === 'graph').map((pt) => [pt.powerKw, pt.soc])).toEqual([
      [null, 57],
    ]);
  });

  it('samples the live power and level at most once a minute, only while charging', async () => {
    const m = monitor();
    await m.start();
    await note(m, '2026-10-01T11:00:00Z', CHARGING, 'charging_active', 50);
    const push = (at: string, kw: number) => {
      clock = Date.parse(at);
      return m.ingest('v1', {
        ...live('2026-10-01T11:00:00Z', kw),
        power: { value: kw, updatedAt: at },
        vehicleChargerState: { value: 'charging_active', updatedAt: at },
      } as LiveSessionData);
    };
    await push('2026-10-01T11:00:30Z', 7.2); // under a minute since the last sample
    await push('2026-10-01T11:01:00Z', 7.3);
    // The power reading is 7 minutes old: unknown in the sample.
    await note(m, '2026-10-01T11:08:00Z', CHARGING, 'charging_active', 53);
    await note(m, '2026-10-01T11:10:00Z', PLUGGED, 'charging_ready', 54);
    m.stop();

    const points = await handle.db
      .select()
      .from(chargingCurvePoints)
      .where(eq(chargingCurvePoints.source, 'observed'))
      .orderBy(chargingCurvePoints.ts);
    expect(points.map((pt) => [pt.ts.toISOString().slice(11, 19), pt.powerKw, pt.soc])).toEqual([
      ['11:00:00', null, 50],
      ['11:01:00', expect.closeTo(7.3), 50],
      ['11:08:00', null, 53],
    ]);
  });

  it("keeps the graph's forecast apart from its readings, and drops it when the charge ends", async () => {
    const m = monitor();
    await m.start();
    await note(m, '2026-10-01T11:00:00Z', CHARGING, 'charging_active', 54);
    const t = Date.parse('2026-10-01T11:00:00Z');
    const min = 60_000;
    const graph = (sentAt: number, ...bars: number[][]) =>
      m.ingestParallax('v1', {
        rvm: RVM_CHARGING_GRAPH,
        timestamp: sentAt,
        payload: chargingGraph(...bars),
      });
    const sources = async () =>
      (
        await handle.db
          .select()
          .from(chargingCurvePoints)
          .where(ne(chargingCurvePoints.source, 'observed'))
          .orderBy(chargingCurvePoints.ts)
      ).map((r) => [r.source, (r.ts.getTime() - t) / min, r.soc]);

    // Sent 6 minutes in: two bars so far, then the vehicle's projection.
    clock = t + 6 * min;
    await graph(
      t + 6 * min,
      graphBar(54, 107, t, t + 3 * min),
      graphBar(57, 111, t + 3 * min, t + 6 * min),
      [...int(1, 63), ...int(3, t + 10 * min), ...int(4, t + 14 * min), ...int(6, 3)],
      [...int(1, 70), ...int(3, t + 14 * min), ...int(4, t + 17 * min), ...int(6, 3)],
    );
    await m.ingest('v1', null); // drains the queue
    // Each bar's level is the one at its end.
    expect(await sources()).toEqual([
      ['graph', 0, null],
      ['graph', 3, 54],
      ['graph', 6, 57],
      ['forecast', 10, 63],
      ['forecast', 14, 70],
    ]);

    // The next graph replaces the forecast.
    clock = t + 9 * min;
    await graph(
      t + 9 * min,
      graphBar(54, 107, t, t + 3 * min),
      graphBar(57, 111, t + 3 * min, t + 6 * min),
      graphBar(60, 99, t + 6 * min, t + 9 * min),
      [...int(1, 66), ...int(3, t + 12 * min), ...int(6, 3)],
    );
    await m.ingest('v1', null);
    expect((await sources()).filter(([s]) => s === 'forecast')).toEqual([['forecast', 12, 66]]);

    await note(m, '2026-10-01T11:20:00Z', UNPLUGGED, 'charging_complete', 72);
    expect((await sources()).filter(([s]) => s === 'forecast')).toEqual([]);
    // Three bars and the point closing the last.
    expect((await sources()).filter(([s]) => s === 'graph')).toHaveLength(4);
    m.stop();
  });

  it('resumes a session left open by a restart when the same charge continues', async () => {
    const id = await leftover('2026-10-01T11:00:00Z', [
      ['2026-10-01T11:10:00Z', 11],
      ['2026-10-01T11:50:00Z', 7],
    ]);
    const m = monitor();
    await m.start();
    m.setPluggedIn('v1', true);
    await m.ingest('v1', live('2026-10-01T11:02:00Z', 9));
    m.stop();

    const rows = await sessions();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(id);
    expect(rows[0]!.endedAt).toBeNull();
    expect(rows[0]!.maxPowerKw).toBe(11);
    expect(rows[0]!.avgPowerKw).toBeCloseTo(9); // (11 + 7 + 9) / 3
  });

  /** Stores a breakdown as the last one received before the process stopped. */
  const lastReceived = (msg: ReturnType<typeof breakdown>, at: string) =>
    handle.db
      .insert(parallaxLatest)
      .values({ vehicleId: 'v1', rvm: msg.rvm, payload: msg.payload, messageAt: new Date(at) });

  it('keeps the reported total when a restart lands mid-charge, without counting it twice', async () => {
    // The row already holds the stretch that was running when the process
    // stopped, so its own report must not be added to it again.
    const [row] = await handle.db
      .insert(chargingSessions)
      .values({
        vehicleId: 'v1',
        startedAt: new Date('2026-10-01T07:00:00Z'),
        chargingSeconds: 3600,
        chargingSince: new Date('2026-10-01T08:00:00Z'),
        energyKwh: 12.4, // 10.4 banked + 2 for the stretch that was running
        packKwh: 12,
        thermalKwh: 0.4,
        rangeAddedKm: 70,
      })
      .returning();
    await lastReceived(breakdown(2, 2, 0, 15, 11), '2026-10-01T08:15:00Z');
    // No plug reading: that would say whether the stretch still runs, and this
    // is the case where the process stopped with it going.
    const m = monitor();
    await m.start();
    clock = Date.parse('2026-10-01T09:00:00Z');
    await m.ingest('v1', live('2026-10-01T08:00:00Z', 9));
    await m.ingestParallax('v1', breakdown(2.4, 2.3, 0.1, 60, 14));
    m.stop();

    const rows = await sessions();
    expect(rows).toHaveLength(1);
    const after = rows[0]!;
    expect(after.id).toBe(row!.id);
    expect(after.energyKwh).toBeCloseTo(12.8);
    expect(after.rangeAddedKm).toBe(73);
  });

  it('keeps the finished stretches when the running one grew while the process was down', async () => {
    await handle.db.insert(chargingSessions).values({
      vehicleId: 'v1',
      startedAt: new Date('2026-10-01T07:00:00Z'),
      chargingSeconds: 3600,
      chargingSince: new Date('2026-10-01T09:00:00Z'),
      energyKwh: 10, // 6 from the first stretch + 4 from the running one
      packKwh: 9.6,
      thermalKwh: 0.4,
      rangeAddedKm: 55,
    });
    await lastReceived(breakdown(4, 3.9, 0.1, 20, 22), '2026-10-01T09:20:00Z');
    const m = monitor();
    await m.start();
    clock = Date.parse('2026-10-01T10:00:00Z');
    await m.ingest('v1', live('2026-10-01T07:00:00Z', 9));
    await m.ingestParallax('v1', breakdown(12, 11.7, 0.3, 60, 66));
    m.stop();

    const [row] = await sessions();
    expect(row!.energyKwh).toBeCloseTo(18);
    expect(row!.packKwh).toBeCloseTo(17.4);
    expect(row!.thermalKwh).toBeCloseTo(0.6);
    expect(row!.rangeAddedKm).toBe(99);
  });

  it("doesn't take the previous session's breakdown as a resumed one's", async () => {
    await handle.db.insert(chargingSessions).values({
      vehicleId: 'v1',
      startedAt: new Date('2026-10-01T07:00:00Z'),
      chargingSeconds: 1800,
      chargingSince: null,
      energyKwh: 3,
    });
    // Re-sent on subscribe after this session started, but longer than it has charged.
    await lastReceived(breakdown(35.8, 34.4, 1.4, 313, 162), '2026-10-01T07:40:00Z');
    const m = monitor();
    await m.start();
    clock = Date.parse('2026-10-01T08:00:00Z');
    await m.ingest('v1', {
      ...live('2026-10-01T07:00:00Z', 9),
      totalChargedEnergy: { value: 4 },
    } as LiveSessionData);
    m.stop();

    const [row] = await sessions();
    // No breakdown has reported on this session, so the feed's total stands.
    expect(row!.energyKwh).toBeCloseTo(4);
  });

  it('keeps breakdown totals when the push feed reports its own', async () => {
    const m = monitor();
    await m.start();
    await note(m, '2026-11-13T20:33:00Z', CHARGING, 'charging_active', 51);
    clock = Date.parse('2026-11-13T21:43:00Z');
    await m.ingestParallax('v1', breakdown(10.4, 10, 0.4, 70, 59));
    await note(m, '2026-11-13T21:44:00Z', PLUGGED, PAUSED, 62);
    clock = Date.parse('2026-11-14T02:26:00Z');
    await note(m, '2026-11-14T02:26:00Z', CHARGING, 'charging_active', 63);
    clock = Date.parse('2026-11-14T03:44:00Z');
    await m.ingestParallax('v1', breakdown(26.8, 25.9, 0.9, 78, 146));
    // The feed's counter covers only the stretch in progress.
    await m.ingest('v1', {
      ...live('2026-11-13T20:33:00Z', 11),
      totalChargedEnergy: { value: 26.9 },
      rangeAddedThisSession: { value: 147 },
    } as LiveSessionData);
    m.stop();

    const [row] = await sessions();
    expect(row!.energyKwh).toBeCloseTo(37.2);
    expect(row!.rangeAddedKm).toBe(205);
  });

  it('adds a fresh stretch to what a restart kept, when the car was not charging when it stopped', async () => {
    await handle.db.insert(chargingSessions).values({
      vehicleId: 'v1',
      startedAt: new Date('2026-10-01T07:00:00Z'),
      chargingSeconds: 4200,
      chargingSince: null,
      energyKwh: 10.4,
      packKwh: 10,
      thermalKwh: 0.4,
      rangeAddedKm: 59,
    });
    const m = monitor();
    await m.start();
    m.setPluggedIn('v1', true);
    clock = Date.parse('2026-10-01T12:00:00Z');
    await m.ingest('v1', live('2026-10-01T12:00:00Z', 9));
    await m.noteState('v1', vehicle(CHARGING, 'charging_active', 62, '2026-10-01T12:00:00Z'));
    await m.ingest('v1', null);
    clock = Date.parse('2026-10-01T12:15:00Z');
    await m.ingestParallax('v1', breakdown(1, 0.9, 0.1, 15, 5));
    m.stop();

    const rows = await sessions();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.energyKwh).toBeCloseTo(11.4);
    expect(rows[0]!.rangeAddedKm).toBe(64);
  });

  it('closes the leftover at its last sample and starts anew when a replug charges', async () => {
    const id = await leftover('2026-10-01T08:00:00Z', [['2026-10-01T09:30:00Z', 11]]);
    const m = monitor();
    await m.start();
    m.setPluggedIn('v1', false);
    await note(m, '2026-10-01T12:00:00Z', CHARGING, 'charging_active', 50);
    m.stop();

    const rows = await sessions();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === id)!.endedAt?.toISOString()).toBe('2026-10-01T09:30:00.000Z');
    expect(rows.find((r) => r.id !== id)!.endedAt).toBeNull();
  });

  it('closes the leftover when the vehicle is reported unplugged', async () => {
    const id = await leftover('2026-10-01T08:00:00Z', [['2026-10-01T09:00:00Z', 11]]);
    const m = monitor();
    await m.start();
    m.setPluggedIn('v1', false);
    await m.ingest('v1', null); // let queued work drain
    m.stop();

    const [row] = await handle.db
      .select()
      .from(chargingSessions)
      .where(eq(chargingSessions.id, id));
    expect(row!.endedAt?.toISOString()).toBe('2026-10-01T09:00:00.000Z');
  });

  it('keeps the leftover open while the plug state is unknown', async () => {
    await leftover('2026-10-01T11:00:00Z', [['2026-10-01T11:50:00Z', 11]]);
    const m = monitor();
    await m.start();
    m.stop();
    const rows = await sessions();
    expect(rows[0]!.endedAt).toBeNull();
  });
});
