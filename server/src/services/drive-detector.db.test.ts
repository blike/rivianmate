/**
 * Integration tests against a real Postgres. Skipped unless
 * TEST_DATABASE_URL points at a disposable database (tables are truncated).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, runMigrations } from '../db/client.js';
import { drives, locationPoints, vehicles } from '../db/schema.js';
import { RVM_GEAR, vehicleStateFromParallax } from '../rivian/parallax/index.js';
import type { VehicleState } from '../rivian/types.js';
import { ensureLegacyHistoryTables } from '../testing/legacy-tables.js';
import { b64, int } from '../testing/protobuf.js';
import { DriveDetector } from './drive-detector.js';
import { HistoryKeys } from './history-keys.js';
import { StateHistoryRecorder } from './state-history.js';

const url = process.env.TEST_DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));

describe.skipIf(!url)('DriveDetector with Postgres', () => {
  let handle: ReturnType<typeof createDb>;
  let clock = 0;
  const at = (iso: string) => Date.parse(iso);

  /** Full state as the monitor passes it, every value stamped by Rivian at `stamp`. */
  const state = (
    gear: string,
    stamp: string,
    extra: { km?: number; soc?: number; range?: number } = {},
  ): VehicleState => {
    const v = (value: string | number) => ({ value, timeStamp: stamp });
    return {
      gearStatus: v(gear),
      powerState: v(gear === 'park' ? 'ready' : 'go'),
      gnssSpeed: v(gear === 'park' ? 0 : 15),
      vehicleMileage: v((extra.km ?? 1000) * 1000),
      batteryLevel: v(extra.soc ?? 70),
      distanceToEmpty: v(extra.range ?? 375),
      batteryCapacity: v(111),
      driveMode: v('everyday'),
      gnssLocation: { latitude: 33.07, longitude: -117.26, timeStamp: stamp },
    };
  };
  // The parked grace runs on real timers, shortened; times come from `clock`.
  const detector = () =>
    new DriveDetector(
      handle.db,
      () => {},
      () => clock,
      50,
    );
  const rows = () => handle.db.select().from(drives).orderBy(drives.id);
  /** Waits for the park timer to end every drive. */
  const settle = () =>
    vi.waitFor(async () => expect((await rows()).every((r) => r.endedAt)).toBe(true), {
      timeout: 2000,
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

  it("times a drive by Rivian's stamps, ending when it parked rather than 3 minutes later", async () => {
    const d = detector();
    clock = at('2026-10-01T15:00:05Z'); // heard 5 s after the gear change
    await d.onState(
      'v1',
      state('drive', '2026-10-01T15:00:00Z', { km: 1000, soc: 70, range: 375 }),
    );
    clock = at('2026-10-01T15:20:02Z');
    await d.onState(
      'v1',
      state('park', '2026-10-01T15:20:00Z', { km: 1018.5, soc: 66, range: 357 }),
    );
    await settle();

    const [drive] = await rows();
    expect(drive!.startedAt.toISOString()).toBe('2026-10-01T15:00:00.000Z');
    expect(drive!.endedAt?.toISOString()).toBe('2026-10-01T15:20:00.000Z');
    expect(drive!.distanceKm).toBeCloseTo(18.5);
    expect([drive!.startRangeKm, drive!.endRangeKm, drive!.endBattery]).toEqual([375, 357, 66]);
    expect(drive!.driveMode).toBe('everyday');
  });

  it('leaves out points recorded after it parked', async () => {
    const d = detector();
    clock = at('2026-10-01T15:00:00Z');
    await d.onState('v1', state('drive', '2026-10-01T15:00:00Z'));
    const [drive] = await rows();
    const point = (ts: string) => ({
      vehicleId: 'v1',
      driveId: drive!.id,
      ts: new Date(ts),
      lat: 33.07,
      lon: -117.26,
    });
    // Stamped onto the drive while it was still open, waiting out the grace.
    await handle.db
      .insert(locationPoints)
      .values([point('2026-10-01T15:10:00Z'), point('2026-10-01T15:21:00Z')]);
    clock = at('2026-10-01T15:20:00Z');
    await d.onState('v1', state('park', '2026-10-01T15:20:00Z'));
    await settle();

    const points = await handle.db
      .select({ ts: locationPoints.ts, driveId: locationPoints.driveId })
      .from(locationPoints)
      .orderBy(locationPoints.ts);
    expect(points.map((p) => p.driveId)).toEqual([drive!.id, null]);
  });

  /** Parked since `parkedAt` with the power on, GPS reading 2.5 m/s at `stamp`. */
  const parkedNoise = (parkedAt: string, stamp: string): VehicleState => ({
    ...state('park', parkedAt),
    powerState: { value: 'go', timeStamp: parkedAt },
    gnssSpeed: { value: 2.5, timeStamp: stamp },
  });

  it('ends when it parked despite GPS speed noise while standing still', async () => {
    const d = detector();
    clock = at('2026-10-01T15:00:00Z');
    await d.onState('v1', state('drive', '2026-10-01T15:00:00Z'));
    clock = at('2026-10-01T15:20:00Z');
    await d.onState('v1', state('park', '2026-10-01T15:20:00Z'));
    clock = at('2026-10-01T15:21:00Z');
    await d.onState('v1', parkedNoise('2026-10-01T15:20:00Z', '2026-10-01T15:21:00Z'));
    await settle();

    const [drive] = await rows();
    expect(drive!.endedAt?.toISOString()).toBe('2026-10-01T15:20:00.000Z');
  });

  it("doesn't start a drive from GPS speed noise after one ends", async () => {
    const d = detector();
    clock = at('2026-10-01T15:00:00Z');
    await d.onState('v1', state('drive', '2026-10-01T15:00:00Z'));
    clock = at('2026-10-01T15:20:00Z');
    await d.onState('v1', state('park', '2026-10-01T15:20:00Z'));
    await settle();
    for (const stamp of ['2026-10-01T15:24:00Z', '2026-10-01T15:25:00Z']) {
      clock = at(stamp);
      await d.onState('v1', parkedNoise('2026-10-01T15:20:00Z', stamp));
    }

    expect(await rows()).toHaveLength(1);
  });

  it('keeps a stop shorter than the grace in the same drive', async () => {
    const d = detector();
    clock = at('2026-10-01T15:00:00Z');
    await d.onState('v1', state('drive', '2026-10-01T15:00:00Z'));
    clock = at('2026-10-01T15:10:00Z');
    await d.onState('v1', state('park', '2026-10-01T15:10:00Z'));
    await d.onState('v1', parkedNoise('2026-10-01T15:10:00Z', '2026-10-01T15:10:30Z'));
    await d.onState('v1', state('drive', '2026-10-01T15:11:00Z'));
    clock = at('2026-10-01T15:20:00Z');
    await d.onState('v1', state('park', '2026-10-01T15:20:00Z'));
    await settle();

    const all = await rows();
    expect(all.map((r) => [r.startedAt.toISOString(), r.endedAt!.toISOString()])).toEqual([
      ['2026-10-01T15:00:00.000Z', '2026-10-01T15:20:00.000Z'],
    ]);
  });

  it('splits drives around a longer stop with the power on', async () => {
    const d = detector();
    clock = at('2026-10-01T15:00:00Z');
    await d.onState('v1', state('drive', '2026-10-01T15:00:00Z'));
    clock = at('2026-10-01T15:10:00Z');
    await d.onState('v1', state('park', '2026-10-01T15:10:00Z'));
    await settle();
    for (const stamp of ['2026-10-01T15:14:00Z', '2026-10-01T15:17:00Z']) {
      clock = at(stamp);
      await d.onState('v1', parkedNoise('2026-10-01T15:10:00Z', stamp));
    }
    clock = at('2026-10-01T15:20:00Z');
    await d.onState('v1', state('drive', '2026-10-01T15:20:00Z'));
    clock = at('2026-10-01T15:30:00Z');
    await d.onState('v1', state('park', '2026-10-01T15:30:00Z'));
    await settle();

    const all = await rows();
    expect(all.map((r) => [r.startedAt.toISOString(), r.endedAt!.toISOString()])).toEqual([
      ['2026-10-01T15:00:00.000Z', '2026-10-01T15:10:00.000Z'],
      ['2026-10-01T15:20:00.000Z', '2026-10-01T15:30:00.000Z'],
    ]);
  });

  it('goes by GPS speed for a vehicle that reports no gear', async () => {
    const d = detector();
    clock = at('2026-10-01T15:00:00Z');
    const { gearStatus: _, ...moving } = state('drive', '2026-10-01T15:00:00Z');
    await d.onState('v1', moving);

    expect(await rows()).toHaveLength(1);
  });

  it('records an R2 drive from Parallax gear and legacy mileage alone', async () => {
    // An R2 leaves legacy gear and power null, so gear comes from Parallax.
    // Its legacy mileage is whole km, and its GPS speed is a stale reading
    // from hours earlier.
    const r2 = (gear: number, km: number, stamp: string): VehicleState => ({
      ...vehicleStateFromParallax(RVM_GEAR, b64(int(1, gear)), stamp),
      vehicleMileage: { value: km * 1000, timeStamp: stamp },
      gnssSpeed: { value: 5.377, timeStamp: '2026-10-12T10:39:09Z' },
      batteryLevel: { value: 62, timeStamp: stamp },
    });
    const d = detector();
    clock = at('2026-10-12T13:58:12Z');
    await d.onState('v1', r2(4, 429, '2026-10-12T13:58:09.952Z'));
    clock = at('2026-10-12T14:15:46Z');
    await d.onState('v1', r2(1, 443, '2026-10-12T14:15:43.162Z'));
    await settle();

    const [drive, ...more] = await rows();
    expect(more).toHaveLength(0);
    expect(drive!.startedAt.toISOString()).toBe('2026-10-12T13:58:09.952Z');
    expect(drive!.endedAt!.toISOString()).toBe('2026-10-12T14:15:43.162Z');
    expect(drive!.distanceKm).toBe(14);
  });

  it('ends at once when the parked state arrives late (e.g. after the host slept)', async () => {
    const d = detector();
    clock = at('2026-10-01T14:49:00Z');
    await d.onState('v1', state('drive', '2026-10-01T14:49:00Z'));
    clock = at('2026-10-01T15:04:30Z'); // asleep until now; parked at 14:55
    await d.onState('v1', state('park', '2026-10-01T14:55:00Z'));
    await settle();

    const [drive] = await rows();
    expect(drive!.endedAt?.toISOString()).toBe('2026-10-01T14:55:00.000Z');
  });

  it('continues a drive still going across a restart, and closes a stale one', async () => {
    const [ongoing] = await handle.db
      .insert(drives)
      .values({
        vehicleId: 'v1',
        startedAt: new Date('2026-10-01T15:00:00Z'),
        startMileageM: 1_000_000,
      })
      .returning();
    await handle.db.insert(locationPoints).values({
      vehicleId: 'v1',
      driveId: ongoing!.id,
      ts: new Date('2026-10-01T15:10:00Z'),
      lat: 33.07,
      lon: -117.26,
    });

    clock = at('2026-10-01T15:12:00Z');
    const d = detector();
    await d.onState('v1', state('drive', '2026-10-01T15:12:00Z', { km: 1012 }));
    expect(await rows()).toHaveLength(1);
    clock = at('2026-10-01T15:30:00Z');
    await d.onState('v1', state('park', '2026-10-01T15:30:00Z', { km: 1020 }));
    await settle();
    const [resumed] = await rows();
    expect(resumed!.distanceKm).toBeCloseTo(20);

    // A drive whose last reading is an hour old is over: closed at that reading.
    const [stale] = await handle.db
      .insert(drives)
      .values({ vehicleId: 'v1', startedAt: new Date('2026-10-01T16:00:00Z') })
      .returning();
    await handle.db.insert(locationPoints).values({
      vehicleId: 'v1',
      driveId: stale!.id,
      ts: new Date('2026-10-01T16:20:00Z'),
      lat: 33.08,
      lon: -117.27,
    });
    clock = at('2026-10-01T17:20:00Z');
    await detector().onState('v1', state('drive', '2026-10-01T17:20:00Z'));
    const all = await rows();
    expect(all.find((r) => r.id === stale!.id)!.endedAt?.toISOString()).toBe(
      '2026-10-01T16:20:00.000Z',
    );
    expect(all).toHaveLength(3); // and a new drive started
  });

  it('closes an unwatched drive at the last reading recorded while it was in gear', async () => {
    const [open] = await handle.db
      .insert(drives)
      .values({
        vehicleId: 'v1',
        startedAt: new Date('2026-10-01T16:00:00Z'),
        startMileageM: 1_000_000,
      })
      .returning();
    const recorder = new StateHistoryRecorder(handle.db, new HistoryKeys(handle.db), () => clock);
    for (const [gear, stamp, km] of [
      ['drive', '2026-10-01T16:00:00Z', 1000],
      ['drive', '2026-10-01T16:20:00Z', 1012],
      ['park', '2026-10-01T16:25:00Z', 1012],
    ] as const) {
      const s = state(gear, stamp, { km, soc: gear === 'park' ? 65 : 66 });
      // Gear keeps its stamp from when it changed, as the monitor's cache does.
      if (gear === 'drive') s.gearStatus = { value: 'drive', timeStamp: '2026-10-01T16:00:00Z' };
      await recorder.record('v1', s, Object.keys(s));
    }
    await detector().closeDanglingDrives([]);

    const [closed] = await rows();
    expect(closed!.id).toBe(open!.id);
    expect(closed!.endedAt?.toISOString()).toBe('2026-10-01T16:20:00.000Z');
    expect([closed!.endMileageM, closed!.endBattery, closed!.distanceKm]).toEqual([
      1_012_000, 66, 12,
    ]);
  });

  it('records drives Rivian delivers hours late at their own times', async () => {
    // Recorded on Oct 3–4, 2026: the vehicle lost signal mid-drive at 21:37Z,
    // was driven twice more without it, and Rivian delivered those readings
    // the next morning. A restart happened in between.
    const [open] = await handle.db
      .insert(drives)
      .values({
        vehicleId: 'v1',
        startedAt: new Date('2026-10-03T21:20:50Z'),
        startMileageM: 6_974_436,
      })
      .returning();
    await handle.db.insert(locationPoints).values({
      vehicleId: 'v1',
      driveId: open!.id,
      ts: new Date('2026-10-03T21:36:58Z'),
      lat: 34.0,
      lon: -116.05,
    });

    // Restarted overnight; Rivian's last known state is from before the signal was lost.
    clock = at('2026-10-04T10:16:16Z');
    const d = detector();
    await d.onState('v1', state('drive', '2026-10-03T21:36:55Z', { km: 6993.172 }));
    expect((await rows())[0]!.endedAt).toBeNull();

    // The morning's late delivery, in order.
    clock = at('2026-10-04T16:19:52Z');
    await d.onState('v1', state('drive', '2026-10-03T21:36:55Z', { km: 6993.172 }));
    await d.onState('v1', state('park', '2026-10-03T21:42:11Z', { km: 6996.145 }));
    // Powered on now, with yesterday's speed still in the state: not moving.
    await d.onState('v1', {
      ...state('park', '2026-10-03T21:42:11Z', { km: 6996.145 }),
      powerState: { value: 'go', timeStamp: '2026-10-04T16:20:40Z' },
      gnssSpeed: { value: 23.14, timeStamp: '2026-10-03T21:37:03Z' },
    });
    await d.onState('v1', state('drive', '2026-10-04T00:13:20Z', { km: 6996.145 }));
    await d.onState('v1', state('park', '2026-10-04T00:15:12Z', { km: 6998.044 }));
    await d.onState('v1', state('drive', '2026-10-04T00:48:37Z', { km: 6998.047 }));
    await d.onState('v1', state('reverse', '2026-10-04T00:53:13Z', { km: 6999.9 }));
    await d.onState('v1', state('park', '2026-10-04T00:58:45Z', { km: 6999.989 }));
    await d.onState('v1', state('park', '2026-10-04T14:05:20Z', { km: 6999.989 }));

    // Then live again.
    clock = at('2026-10-04T16:21:40Z');
    await d.onState('v1', state('drive', '2026-10-04T16:21:32Z', { km: 6999.989 }));
    clock = at('2026-10-04T16:43:00Z');
    await d.onState('v1', state('park', '2026-10-04T16:42:42Z', { km: 7028.705 }));
    await settle();

    const all = await rows();
    expect(all.map((r) => [r.startedAt.toISOString(), r.endedAt!.toISOString()])).toEqual([
      ['2026-10-03T21:20:50.000Z', '2026-10-03T21:42:11.000Z'],
      ['2026-10-04T00:13:20.000Z', '2026-10-04T00:15:12.000Z'],
      ['2026-10-04T00:48:37.000Z', '2026-10-04T00:58:45.000Z'],
      ['2026-10-04T16:21:32.000Z', '2026-10-04T16:42:42.000Z'],
    ]);
    expect(all.map((r) => r.distanceKm)).toEqual([
      expect.closeTo(21.709),
      expect.closeTo(1.899),
      expect.closeTo(1.942),
      expect.closeTo(28.716),
    ]);
  });

  it("doesn't let a park from before the drive's latest movement end it", async () => {
    const d = detector();
    clock = at('2026-10-01T15:00:00Z');
    await d.onState('v1', state('drive', '2026-10-01T15:00:00Z'));
    clock = at('2026-10-01T15:10:00Z');
    await d.onState('v1', state('drive', '2026-10-01T15:10:00Z'));
    await d.onState('v1', state('park', '2026-10-01T14:50:00Z')); // last night's, delivered late
    await new Promise((r) => setTimeout(r, 120));
    expect((await rows())[0]!.endedAt).toBeNull();
  });

  it('records the navigation destination on the drive', async () => {
    const d = detector();
    const destination = { name: '100 Main St', lat: 32.88, lon: -117.22 };
    await d.noteDestination('v1', destination); // set while parked
    clock = at('2026-10-01T15:00:00Z');
    await d.onState('v1', state('drive', '2026-10-01T15:00:00Z'));
    let [drive] = await rows();
    expect(drive!.destinationName).toBe('100 Main St');

    await d.noteDestination('v1', { name: 'Elsewhere', lat: 33, lon: -117 }); // rerouted
    [drive] = await rows();
    expect([drive!.destinationName, drive!.destinationLat]).toEqual(['Elsewhere', 33]);
  });

  it('repairs drives recorded before the gear decided, in the migration', async () => {
    const drive = async (startedAt: string, endedAt: string) =>
      (
        await handle.db
          .insert(drives)
          .values({ vehicleId: 'v1', startedAt: new Date(startedAt), endedAt: new Date(endedAt) })
          .returning()
      )[0]!;
    // The migration ran before state history replaced snapshots.
    await ensureLegacyHistoryTables(handle.sql);
    await handle.sql`TRUNCATE vehicle_state_snapshots`;
    const snapshot = (ts: string, gear: string, gearAt: string) => ({
      vehicle_id: 'v1',
      ts,
      data: JSON.stringify({ gearStatus: { value: gear, timeStamp: gearAt } }),
    });
    // Held open by GPS noise until the vehicle slept, 5 minutes after it parked.
    const late = await drive('2026-10-01T15:00:00Z', '2026-10-01T15:25:00Z');
    // Ended when it parked.
    const exact = await drive('2026-10-01T16:00:00Z', '2026-10-01T16:20:00Z');
    await handle.sql`INSERT INTO vehicle_state_snapshots ${handle.sql([
      snapshot('2026-10-01T15:00:05Z', 'drive', '2026-10-01T15:00:00Z'),
      snapshot('2026-10-01T15:20:05Z', 'park', '2026-10-01T15:20:00Z'),
      snapshot('2026-10-01T16:00:05Z', 'drive', '2026-10-01T16:00:00Z'),
      snapshot('2026-10-01T16:20:05Z', 'park', '2026-10-01T16:20:00Z'),
    ])}`;
    const point = (driveId: number, ts: string) => ({
      vehicleId: 'v1',
      driveId,
      ts: new Date(ts),
      lat: 33.07,
      lon: -117.26,
    });
    await handle.db
      .insert(locationPoints)
      .values([
        point(late.id, '2026-10-01T15:19:00Z'),
        point(late.id, '2026-10-01T15:22:00Z'),
        point(exact.id, '2026-10-01T16:19:00Z'),
        point(exact.id, '2026-10-01T16:21:00Z'),
      ]);

    const migration = readFileSync(
      join(here, '..', '..', 'drizzle', '0015_drive_ends_at_park.sql'),
      'utf8',
    );
    for (const statement of migration.split('--> statement-breakpoint')) {
      await handle.sql.unsafe(statement);
    }

    expect((await rows()).map((r) => r.endedAt?.toISOString())).toEqual([
      '2026-10-01T15:20:00.000Z',
      '2026-10-01T16:20:00.000Z',
    ]);
    const points = await handle.db
      .select({ driveId: locationPoints.driveId })
      .from(locationPoints)
      .orderBy(locationPoints.ts);
    expect(points.map((p) => p.driveId)).toEqual([late.id, null, exact.id, null]);
  });
});
