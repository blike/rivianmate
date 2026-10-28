import type { VehicleState } from '@server/api-types';
import { describe, expect, it } from 'vitest';
import {
  capacityOfRated,
  capacityTrend,
  healthChecks,
  healthSummary,
  packOfRated,
  tireRotation,
  tireTrend,
} from './health';

const v = (value: string | number) => ({ timeStamp: 't', value });
const state = (fields: Record<string, string | number>) =>
  Object.fromEntries(Object.entries(fields).map(([k, x]) => [k, v(x)])) as unknown as VehicleState;

// As observed from a real vehicle.
const healthy = {
  batteryHvThermalEvent: 'off',
  twelveVoltBatteryHealth: 'NORMAL_OPERATION',
  tirePressureStatusFrontLeft: 'OK',
  tirePressureStatusFrontRight: 'OK',
  tirePressureStatusRearLeft: 'OK',
  tirePressureStatusRearRight: 'OK',
  wiperFluidState: 'normal',
  otaCurrentVersion: '2026.36.0',
  otaAvailableVersion: '0.0.0',
};

describe('healthChecks', () => {
  it('reads a healthy vehicle as all good', () => {
    // Brake fluid is sent empty while it's fine, so it's absent here.
    const checks = healthChecks(state(healthy));
    expect(checks.map((c) => [c.label, c.level, c.value])).toEqual([
      ['Battery pack', 'good', 'Normal'],
      ['12V battery', 'good', 'Normal'],
      ['Tires', 'good', 'Normal'],
      ['Brake fluid', 'good', 'Normal'],
      ['Washer fluid', 'good', 'Normal'],
      ['Software', 'good', 'Up to date'],
    ]);
    expect(healthSummary(checks)).toMatchObject({
      level: 'good',
      title: 'Everything looks good',
      detail:
        'No warnings from the battery pack, 12V battery, tires, brake fluid, washer fluid and software.',
    });
  });

  it('flags what the vehicle warns about', () => {
    const s = state({
      ...healthy,
      tirePressureStatusRearLeft: 'LOW',
      wiperFluidState: 'low',
      brakeFluidLow: 'true',
    });
    const checks = healthChecks(s);
    const flagged = checks.filter((c) => c.level === 'attention').map((c) => c.value);
    expect(flagged).toEqual(['Check rear left', 'Low', 'Low']);
    expect(healthSummary(checks)).toMatchObject({
      level: 'attention',
      title: '3 things need a look',
    });
  });

  it('shows a pending update as information, a failed one as a problem', () => {
    const pending = healthChecks(state({ ...healthy, otaAvailableVersion: '2026.40.0' })).at(-1);
    expect(pending).toMatchObject({ level: 'info', value: 'Update available' });
    const failed = healthChecks(state({ ...healthy, otaCurrentStatus: 'Install_Failed' })).at(-1);
    expect(failed).toMatchObject({ level: 'attention', value: 'Install failed' });
  });

  it("shows the installed version where the vehicle doesn't report updates", () => {
    // As an R2: Parallax sends only the installed version.
    const software = healthChecks(state({ otaCurrentVersion: '2026.36.0' })).at(-1);
    expect(software).toMatchObject({ level: 'good', value: '2026.36.0' });
  });

  it('waits for readings before judging', () => {
    expect(healthChecks(undefined)).toHaveLength(6);
    expect(healthSummary(healthChecks(undefined))).toMatchObject({ level: 'unknown' });
    expect(
      healthSummary(healthChecks(state({ twelveVoltBatteryHealth: 'NORMAL_OPERATION' }))),
    ).toMatchObject({ level: 'good', detail: 'No warnings from the 12V battery.' });
  });

  it('leaves out checks the vehicle never reports (no legacy feed)', () => {
    // As an R1S on Parallax alone: no thermal event, brake or washer fluid.
    const parallaxOnly = state({
      twelveVoltBatteryHealth: 'NORMAL_OPERATION',
      tirePressureStatusFrontLeft: 'OK',
      otaCurrentVersion: '2026.36.0',
    });
    const checks = healthChecks(parallaxOnly);
    expect(checks.map((c) => c.label)).toEqual(['12V battery', 'Tires', 'Software']);
    expect(healthSummary(checks).detail).toBe(
      'No warnings from the 12V battery, tires and software.',
    );
  });

  it('checks a TeslaMate vehicle on its pack and software only', () => {
    // TeslaMate logs tire pressures but no warnings, and no pending updates.
    const tesla = state({
      batteryLevel: 62,
      tirePressureFrontLeft: 2.9,
      otaCurrentVersion: '2026.20.3',
    });
    const checks = healthChecks(tesla, 92);
    expect(checks.map((c) => [c.label, c.value])).toEqual([
      ['Battery pack', 'Normal'],
      ['Software', '2026.20.3'],
    ]);
    expect(healthSummary(checks).detail).toBe('No warnings from the battery pack and software.');
  });
});

describe('battery pack', () => {
  const packCheck = (fields: Record<string, string | number>, ofRated: number | null) =>
    healthChecks(state(fields), ofRated).find((c) => c.key === 'pack');

  it('judges usable capacity against rated, normal from 70%', () => {
    expect(packCheck(healthy, 95)).toMatchObject({ level: 'good', value: 'Normal' });
    expect(packCheck(healthy, 70)).toMatchObject({ level: 'good', value: 'Normal' });
    expect(packCheck(healthy, 68.6)).toMatchObject({ level: 'attention', value: '69% of rated' });
  });

  it('flags a thermal event whatever the capacity', () => {
    const hot = { ...healthy, batteryHvThermalEvent: 'on' };
    expect(packCheck(hot, 95)).toMatchObject({ level: 'attention', value: 'Thermal event' });
  });

  it('shows for a vehicle without the thermal reading (an R2) once capacity is known', () => {
    const r2 = { twelveVoltBatteryHealth: 'NORMAL_OPERATION' };
    expect(packCheck(r2, null)).toBeUndefined();
    // Kept in place while battery health loads, so the tiles don't shift.
    expect(healthChecks(state(r2), null, true).map((c) => c.key)).toEqual(['pack', '12v']);
    expect(packCheck(r2, 92)).toMatchObject({ level: 'good', value: 'Normal' });
  });

  it('takes the latest capacity, or the last reported one, against rated', () => {
    const rated = { kwh: 110, at: 't' };
    expect(
      packOfRated({ latest: { kwh: 104.5, at: 't' }, reported: [], ratedCapacity: rated }),
    ).toBeCloseTo(95);
    expect(
      packOfRated({
        latest: null,
        reported: [{ day: 'd', at: 't', kwh: 99 }],
        ratedCapacity: rated,
      }),
    ).toBeCloseTo(90);
    expect(
      packOfRated({ latest: { kwh: 104.5, at: 't' }, reported: [], ratedCapacity: null }),
    ).toBeNull();
    expect(packOfRated(undefined)).toBeNull();
  });
});

describe('tireTrend', () => {
  const DAY = 86_400_000;
  const days = (n: number, f: (i: number) => Record<string, number>) =>
    Array.from({ length: n }, (_, i) => ({ ts: i * DAY, ...f(i) }));

  it('ignores pressure moving with the weather', () => {
    const t = tireTrend(
      days(10, (i) => ({
        fl: 3.2 - i * 0.02,
        fr: 3.2 - i * 0.02,
        rl: 3.1 - i * 0.02,
        rr: 3.1 - i * 0.02,
      })),
    );
    expect(t?.leaking).toBeNull();
    expect(t?.change.fl).toBeCloseTo(-0.16);
  });

  it('spots one tire falling against the others', () => {
    const t = tireTrend(days(10, (i) => ({ fl: 3.2, fr: 3.2 - i * 0.03, rl: 3.1, rr: 3.1 })));
    expect(t?.leaking).toBe('fr');
  });

  it('needs a few days of readings', () => {
    expect(tireTrend(days(3, () => ({ fl: 3 })))).toBeNull();
    expect(
      tireTrend(Array.from({ length: 10 }, (_, i) => ({ ts: i * 3600_000, fl: 3 }))),
    ).toBeNull();
  });
});

describe('capacityTrend', () => {
  it('compares the latest reading with the first', () => {
    expect(capacityTrend([])).toBeNull();
    expect(capacityTrend([{ at: 'a', kwh: 111 }])).toEqual({
      latestKwh: 111,
      changeKwh: null,
      since: null,
    });
    const t = capacityTrend([
      { at: 'a', kwh: 111.5 },
      { at: 'b', kwh: 111.2 },
    ]);
    expect(t?.changeKwh).toBeCloseTo(-0.3);
    expect(t?.since).toBe('a');
  });
});

describe('capacityOfRated', () => {
  it('compares reported capacity with rated', () => {
    expect(capacityOfRated(104.5, 110)).toBeCloseTo(95);
    // Packs often report a little over rated when new.
    expect(capacityOfRated(111.25, 110)).toBeCloseTo(101.14);
    expect(capacityOfRated(111, null)).toBeNull();
    expect(capacityOfRated(null, 110)).toBeNull();
  });
});

describe('tireRotation', () => {
  const at = '2026-10-19T15:20:51Z';
  const reading = (odometerKm: number | null, intervalKm = 14_484.096) => ({
    odometerAtLastRotationKm: 0.001,
    intervalKm,
    odometerKm,
    at,
  });

  it('counts down to the next rotation', () => {
    // As observed: never rotated, every 9,000 mi, at 8,260 km.
    const r = tireRotation(reading(8_260));
    expect(r).toMatchObject({ off: false, level: 'good', dueAtKm: 14_484.097 });
    expect(r?.off === false && r.remainingKm).toBeCloseTo(6_224.1);
    expect(r?.sinceKm).toBeCloseTo(8_260);
  });

  it('flags one coming up, then one overdue', () => {
    expect(tireRotation(reading(14_000))).toMatchObject({ level: 'info' });
    expect(tireRotation(reading(14_484.097))).toMatchObject({ level: 'attention', remainingKm: 0 });
    expect(tireRotation(reading(16_000))).toMatchObject({ level: 'attention' });
  });

  it('reads an interval of 0 as the reminder off', () => {
    expect(tireRotation(reading(8_260, 0))).toMatchObject({ off: true });
  });

  it('is unknown without an odometer, and absent without a reading', () => {
    expect(tireRotation(reading(null))).toMatchObject({
      level: 'unknown',
      sinceKm: null,
      remainingKm: null,
    });
    expect(tireRotation(null)).toBeNull();
  });
});
