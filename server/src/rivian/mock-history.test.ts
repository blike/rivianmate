import { describe, expect, it } from 'vitest';
import { MILEAGE_GAP_M, pastHistory } from './mock-history.js';

const DAY_MS = 86_400_000;
const from = Date.UTC(2024, 1, 10, 6);
const opts = {
  from,
  to: from + 1000 * DAY_MS,
  startMileageM: 12_000,
  endMileageM: 56_000_000,
  capacityKwh: 135,
  endBattery: 78,
};

describe('pastHistory', () => {
  const { drives, charges } = pastHistory(opts);

  it('gives the same history for the same inputs', () => {
    expect(pastHistory(opts)).toEqual({ drives, charges });
  });

  it('spans the period, with nothing at or after its end', () => {
    expect(drives.length).toBeGreaterThan(2000);
    expect(drives[0]!.startedAt).toBeLessThan(from + 2 * DAY_MS);
    expect(drives.at(-1)!.startedAt).toBeGreaterThan(opts.to - 3 * DAY_MS);
    expect(Math.max(...drives.map((d) => d.endedAt))).toBeLessThan(opts.to);
    expect(Math.max(...charges.map((c) => c.startedAt))).toBeLessThan(opts.to);
  });

  it('fills the odometer between its readings exactly, drive after drive', () => {
    expect(drives[0]!.startMileageM).toBe(opts.startMileageM);
    expect(drives.at(-1)!.endMileageM + MILEAGE_GAP_M).toBeCloseTo(opts.endMileageM, 3);
    for (let i = 1; i < drives.length; i++) {
      expect(drives[i]!.startMileageM).toBeCloseTo(drives[i - 1]!.endMileageM + MILEAGE_GAP_M, 3);
    }
  });

  it('never overlaps a drive with the next one or a charge', () => {
    const events = [
      ...drives.map((d) => [d.startedAt, d.endedAt] as const),
      ...charges.map((c) => [c.startedAt, c.endedAt] as const),
    ].sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < events.length; i++) {
      expect(events[i]![0]).toBeGreaterThanOrEqual(events[i - 1]![1]);
    }
  });

  it('carries the level from drive to charge to drive, never near empty', () => {
    const events = [
      ...drives.map((d) => ({ at: d.startedAt, start: d.startBattery, end: d.endBattery })),
      ...charges.map((c) => ({ at: c.startedAt, start: c.startSoc, end: c.endSoc })),
    ].sort((a, b) => a.at - b.at);
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.start).toBeCloseTo(events[i - 1]!.end, 6);
    }
    expect(Math.min(...events.map((e) => e.end))).toBeGreaterThan(10);
    expect(Math.max(...events.map((e) => e.end))).toBeLessThanOrEqual(90);
    expect(events.at(-1)!.end).toBeCloseTo(opts.endBattery, 6);
  });

  it('has weekends away, charging fast on the way', () => {
    const fast = charges.filter((c) => !c.home);
    expect(drives.filter((d) => d.roadTrip).length).toBeGreaterThan(40);
    expect(fast.length).toBeGreaterThan(20);
    expect(Math.min(...fast.map((c) => c.powerKw))).toBeGreaterThan(50);
  });

  it('is colder in winter', () => {
    const month = (m: number) => {
      const ts = drives.filter((d) => new Date(d.startedAt).getUTCMonth() === m);
      return ts.reduce((s, d) => s + d.tempC, 0) / ts.length;
    };
    expect(month(0)).toBeLessThan(month(6) - 15);
  });
});
