import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  NotAnExportError,
  TimeZoneClock,
  firstDataId,
  parseLocalTime,
  parseRow,
  readRows,
  rowState,
} from './parse.js';
import { type Existing, buildPlan, odometerFits, rangeOf, scanFiles } from './plan.js';
import { asleep, awake, chargeRows, csvOf, driveRows } from '../../testing/electrafi-rows.js';

let dir: string;
let count = 0;
const fileOf = async (csv: string) => {
  const path = join(dir, `${count++}.csv`);
  await writeFile(path, csv);
  return path;
};
const scanOf = async (rows: Parameters<typeof csvOf>[0]) =>
  scanFiles([await fileOf(csvOf(rows))], 'UTC');
const cells = (row: Record<string, string | number>) =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k, String(v)]));

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'electrafi-test-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('parsing', () => {
  it('reads hours with and without a leading zero', () => {
    expect(parseLocalTime('2026-10-29 8:02:08')).toMatchObject({ hour: 8, minute: 2, second: 8 });
    expect(parseLocalTime('2026-10-29 18:02:08')).toMatchObject({ hour: 18 });
    expect(parseLocalTime('yesterday')).toBeNull();
    expect(parseLocalTime('2026-13-29 18:02:08')).toBeNull();
  });

  it('converts to the units RivianMate stores', () => {
    const row = parseRow(
      cells({
        data_id: 1,
        Date: '2026-10-30 12:00:00',
        odometer: 5222.492145719,
        battery_range: 195.110494,
        speed: 53.03,
        shift_state: 'D',
      }),
    )!;
    expect(row.mileageM).toBe(8404786);
    expect(row.rangeKm).toBe(314);
    expect(row.speedKmh).toBeCloseTo(85.34, 1);
    expect(row.gear).toBe('drive');
  });

  it('takes tires in order, leaving out a sensor with no reading', () => {
    const tires = (id_s: string) =>
      parseRow(cells({ data_id: 1, Date: '2026-10-30 12:00:00', id_s }))!.tires;
    expect(tires('3.28 3.35 3.23 3.33')).toEqual([3.28, 3.35, 3.23, 3.33]);
    expect(tires('6.38 6.38 6.38 6.38')).toEqual([null, null, null, null]);
    expect(tires('')).toEqual([null, null, null, null]);
  });

  it('never turns a blank into a reading', () => {
    const row = parseRow(cells({ data_id: 1, Date: '2026-10-30 12:00:00' }))!;
    expect(rowState(row, 0)).toEqual({});
  });

  it('says whether the vehicle was asleep, awake or under way', () => {
    const power = (state: string, shift_state = '') =>
      rowState(parseRow(cells({ data_id: 1, Date: '2026-10-30 12:00:00', state, shift_state }))!, 0)
        .powerState?.value;
    expect(power('asleep')).toBe('sleep');
    expect(power('online', 'P')).toBe('ready');
    expect(power('online', 'D')).toBe('go');
    expect(power('online', 'R')).toBe('go');
    expect(power('')).toBeUndefined();
  });

  it("maps charging to Rivian's values", () => {
    const state = (charging_state: string) =>
      rowState(parseRow(cells({ data_id: 1, Date: '2026-10-30 12:00:00', charging_state }))!, 0);
    expect(state('Charging').chargerState?.value).toBe('charging_active');
    expect(state('Complete').chargerStatus?.value).toBe('chrgr_sts_connected_no_chrg');
    expect(state('Disconnected').chargerStatus?.value).toBe('chrgr_sts_not_connected');
  });

  it('refuses a file that is not an export', async () => {
    const path = await fileOf('name,when\nfoo,bar\n');
    await expect(firstDataId(path)).rejects.toThrow(NotAnExportError);
  });

  it('counts rows it cannot date, and reads overlapping files once, in order', async () => {
    const later = await fileOf(
      csvOf([
        awake('2026-10-30 12:01:00', { data_id: 2 }),
        awake('2026-10-30 12:02:00', { data_id: 3 }),
      ]),
    );
    const earlier = await fileOf(
      csvOf([
        awake('2026-10-30 12:00:00', { data_id: 1 }),
        awake('2026-10-30 12:01:00', { data_id: 2 }),
        awake('nonsense', { data_id: 9 }),
      ]),
    );
    const stats = { unreadable: 0 };
    const ids: number[] = [];
    for await (const { row } of readRows([later, earlier], 'UTC', stats)) ids.push(row.dataId);
    expect(ids).toEqual([1, 2, 3]);
    expect(stats.unreadable).toBe(1);
  });
});

describe('time zones', () => {
  const local = (hour: number, minute = 0, month = 10, day = 30) => ({
    year: 2026,
    month,
    day,
    hour,
    minute,
    second: 0,
  });

  it('places local times in the zone', () => {
    const clock = new TimeZoneClock('America/Los_Angeles');
    expect(new Date(clock.next(local(12))).toISOString()).toBe('2026-10-30T19:00:00.000Z');
    expect(clock.dateOf(Date.UTC(2026, 9, 31, 2))).toBe('2026-10-30');
  });

  it('walks through the hour clocks repeat in row order', () => {
    const clock = new TimeZoneClock('America/Los_Angeles');
    const nov1 = (hour: number, minute: number) => local(hour, minute, 11, 1);
    const times = [nov1(1, 30), nov1(1, 45), nov1(1, 15), nov1(1, 30), nov1(2, 0)].map((t) =>
      clock.next(t),
    );
    expect(times.map((t) => new Date(t).toISOString().slice(11, 16))).toEqual([
      '08:30',
      '08:45',
      '09:15',
      '09:30',
      '10:00',
    ]);
  });

  it('reads a time clocks skip by the offset before the skip', () => {
    const clock = new TimeZoneClock('America/Los_Angeles');
    const at = clock.next({ ...local(2, 30), month: 3, day: 8 });
    expect(new Date(at).toISOString()).toBe('2026-03-08T10:30:00.000Z');
  });

  it('takes the dates chosen as whole days in the zone', () => {
    const range = rangeOf('2026-10-30', '2026-10-30', 'America/Chicago');
    expect(new Date(range.from).toISOString()).toBe('2026-10-30T05:00:00.000Z');
    expect(new Date(range.to).toISOString()).toBe('2026-10-31T05:00:00.000Z');
  });
});

describe('finding drives', () => {
  it('reproduces a drive RivianMate recorded live', async () => {
    const { drives } = await scanOf(driveRows());
    expect(drives).toHaveLength(1);
    const [drive] = drives;
    expect(drive!.distanceKm).toBeCloseTo(5.857, 3);
    expect(drive!.start).toMatchObject({ battery: 58.2, rangeKm: 314 });
    expect(drive!.end).toMatchObject({ battery: 57.2, rangeKm: 307, lat: 10.04, lon: 20.02 });
    expect(drive!.driveMode).toBe('everyday');
    expect(new Date(drive!.startedAt).toISOString()).toBe('2026-10-30T12:53:07.000Z');
    expect(new Date(drive!.endedAt).toISOString()).toBe('2026-10-30T13:04:07.000Z');
  });

  it('keeps a short stop in one drive and splits at a long one', async () => {
    const moving = (date: string, odometer: number) => awake(date, { shift_state: 'D', odometer });
    const short = await scanOf([
      moving('2026-10-30 10:00:00', 1),
      awake('2026-10-30 10:01:00', { odometer: 2 }),
      moving('2026-10-30 10:02:00', 2),
      awake('2026-10-30 10:03:00', { odometer: 3 }),
      awake('2026-10-30 10:07:00', { odometer: 3 }),
    ]);
    expect(short.drives).toHaveLength(1);
    const long = await scanOf([
      moving('2026-10-30 10:00:00', 1),
      awake('2026-10-30 10:01:00', { odometer: 2 }),
      awake('2026-10-30 10:05:00', { odometer: 2 }),
      moving('2026-10-30 10:06:00', 2),
      awake('2026-10-30 10:07:00', { odometer: 3 }),
    ]);
    expect(long.drives).toHaveLength(2);
  });

  it('ends a drive cut off by a hole at its last moving row, not whatever follows', async () => {
    const { drives } = await scanOf([
      awake('2025-12-16 19:22:00', { odometer: 100 }),
      awake('2025-12-16 19:23:00', { shift_state: 'D', odometer: 100 }),
      awake('2025-12-16 19:30:00', { shift_state: 'D', odometer: 102 }),
      awake('2026-01-02 20:56:00', { odometer: 147 }),
    ]);
    expect(drives).toHaveLength(1);
    expect(drives[0]!.distanceKm).toBeCloseTo(3.219, 3);
    expect(new Date(drives[0]!.endedAt).toISOString()).toBe('2025-12-16T19:30:00.000Z');
  });

  it('ignores asleep rows and ends a drive open at the last row', async () => {
    const { drives } = await scanOf([
      awake('2026-10-30 10:00:00', { shift_state: 'D', odometer: 1 }),
      asleep('2026-10-30 10:01:00'),
      awake('2026-10-30 10:02:00', { shift_state: 'D', odometer: 2 }),
    ]);
    expect(drives).toHaveLength(1);
  });
});

describe('finding charges', () => {
  it('sums up a charge, leaving the last unplugged row out of its curve', async () => {
    const { charges } = await scanOf(chargeRows(new Date('2026-10-29T08:02:00Z'), 100, 801));
    expect(charges).toHaveLength(1);
    const [charge] = charges;
    expect(charge!.chargingSeconds).toBe(6000);
    expect(charge!.startSoc).toBe(50);
    expect(charge!.endSoc).toBe(55);
    expect(charge!.energyKwh).toBe(10);
    expect(charge!.avgPowerKw).toBe(6);
    expect(charge!.maxPowerKw).toBe(6);
    expect(charge!.curve).toHaveLength(100);
  });

  it("doesn't know where a charge started when the rows begin partway through", async () => {
    const { charges } = await scanOf(chargeRows(new Date('2026-01-02T20:56:00Z'), 9, 614, 19.5));
    expect(charges[0]!.startSoc).toBeNull();
    expect(charges[0]!.energyKwh).toBeCloseTo(20.4, 1);
  });

  it("doesn't count time charging across a hole in the rows", async () => {
    const first = chargeRows(new Date('2026-01-02T20:00:00Z'), 10, 5).slice(0, 5);
    const second = chargeRows(new Date('2026-01-02T22:00:00Z'), 10, 5).slice(0, 5);
    const { charges } = await scanOf([...first, ...second]);
    expect(charges).toHaveLength(1);
    expect(charges[0]!.chargingSeconds).toBe(8 * 60);
  });

  it('tells charges apart by their number', async () => {
    const { charges } = await scanOf([
      ...chargeRows(new Date('2026-01-02T20:00:00Z'), 5, 5),
      ...chargeRows(new Date('2026-01-03T20:00:00Z'), 5, 6),
    ]);
    expect(charges.map((c) => c.chargeNumber)).toEqual([5, 6]);
  });
});

describe('planning', () => {
  const at = (iso: string) => Date.parse(iso);
  const nothing: Existing = {
    heartbeats: [],
    lastLiveAt: null,
    drives: [],
    sessions: [],
    mileage: [],
  };
  const all = { from: at('2026-01-01T00:00:00Z'), to: at('2027-01-01T00:00:00Z') };
  const now = at('2026-10-31T00:00:00Z');

  it('takes a drive starting in the range whole, across its end', async () => {
    const scan = await scanOf(driveRows());
    const plan = buildPlan(scan, nothing, { from: all.from, to: at('2026-10-30T13:00:00Z') }, now);
    expect(plan.drives).toHaveLength(1);
    expect(plan.scope.includes(at('2026-10-30T13:02:00Z'))).toBe(true);
    expect(plan.scope.includes(at('2026-10-30T13:06:00Z'))).toBe(false);
  });

  it('leaves out a drive starting before the range, and its rows', async () => {
    const scan = await scanOf(driveRows());
    const plan = buildPlan(scan, nothing, { from: at('2026-10-30T13:00:00Z'), to: all.to }, now);
    expect(plan.drives).toHaveLength(0);
    expect(plan.scope.includes(at('2026-10-30T13:02:00Z'))).toBe(false);
    expect(plan.scope.includes(at('2026-10-30T13:06:00Z'))).toBe(true);
  });

  it('skips a drive already recorded', async () => {
    const scan = await scanOf(driveRows());
    const plan = buildPlan(
      scan,
      {
        ...nothing,
        drives: [{ startedAt: at('2026-10-30T12:52:21Z'), endedAt: at('2026-10-30T13:04:14Z') }],
      },
      all,
      now,
    );
    expect(plan.drives).toHaveLength(0);
    expect(plan.drivesRecorded).toBe(1);
    expect(plan.scope.includes(at('2026-10-30T12:58:00Z'))).toBe(false);
  });

  it('skips time near a heartbeat, and anything after live recording last reported', () => {
    const heartbeat = at('2026-06-01T12:00:00Z');
    const plan = buildPlan(
      { drives: [], charges: [] },
      { ...nothing, heartbeats: [heartbeat], lastLiveAt: heartbeat },
      all,
      now,
    );
    expect(plan.scope.includes(heartbeat - 10 * 60_000)).toBe(false);
    expect(plan.scope.includes(heartbeat - 30 * 60_000)).toBe(true);
    expect(plan.scope.includes(heartbeat + 30 * 60_000)).toBe(false);
  });

  it('adds to a session it overlaps, and makes a new one otherwise', async () => {
    const scan = await scanOf([
      ...chargeRows(new Date('2026-05-01T10:00:00Z'), 5, 1),
      ...chargeRows(new Date('2026-05-02T10:00:00Z'), 5, 2),
    ]);
    const plan = buildPlan(
      scan,
      {
        ...nothing,
        sessions: [
          {
            id: 7,
            startedAt: at('2026-05-01T09:50:00Z'),
            endedAt: at('2026-05-01T12:00:00Z'),
            imported: false,
          },
        ],
      },
      all,
      now,
    );
    expect(plan.charges.map((c) => c.sessionId)).toEqual([7, null]);
  });

  it('leaves an open session and one from an earlier import alone', async () => {
    const scan = await scanOf(chargeRows(new Date('2026-05-01T10:00:00Z'), 5, 1));
    const session = { id: 7, startedAt: at('2026-05-01T09:50:00Z') };
    const planWith = (s: Existing['sessions'][number]) =>
      buildPlan(scan, { ...nothing, sessions: [s] }, all, now).charges;
    expect(planWith({ ...session, endedAt: null, imported: false })).toEqual([]);
    expect(planWith({ ...session, endedAt: at('2026-05-01T11:00:00Z'), imported: true })).toEqual(
      [],
    );
  });
});

describe('odometerFits', () => {
  const history = [
    { at: 1000, value: 50_000 },
    { at: 2000, value: 60_000 },
  ];
  it('accepts mileage in step with the recorded history', () => {
    expect(odometerFits(history, { at: 500, value: 40_000 })).toBe(true);
    expect(odometerFits(history, { at: 1500, value: 55_000 })).toBe(true);
    expect(odometerFits(history, { at: 3000, value: 70_000 })).toBe(true);
    expect(odometerFits([], { at: 1, value: 1 })).toBe(true);
  });
  it('flags mileage another car would have', () => {
    expect(odometerFits(history, { at: 500, value: 90_000 })).toBe(false);
    expect(odometerFits(history, { at: 1500, value: 5_000 })).toBe(false);
    expect(odometerFits(history, { at: 3000, value: 5_000 })).toBe(false);
  });
});
