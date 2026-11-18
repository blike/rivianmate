import { describe, expect, it } from 'vitest';
import {
  parkedSegments,
  parkedWeek,
  parkedWindows,
  signalLabel,
  wifiBand,
  windowLabel,
} from './insights';

describe('parkedWindows', () => {
  it('keeps whole-hour windows, longest first', () => {
    const windows = [{ minutes: 480 }, { minutes: 8 }, { minutes: 1440 }, { minutes: 10080 }];
    expect(parkedWindows(windows).map((w) => windowLabel(w.minutes))).toEqual([
      'Last 7 days',
      'Last 24 hours',
      'Last 8 hours',
    ]);
  });
});

describe('wifiBand / signalLabel', () => {
  it('names the band and signal strength', () => {
    expect([wifiBand(2437), wifiBand(5240), wifiBand(5955), wifiBand(null)]).toEqual([
      '2.4 GHz',
      '5 GHz',
      '6 GHz',
      null,
    ]);
    expect([signalLabel(-55), signalLabel(-66), signalLabel(-75), signalLabel(-90)]).toEqual([
      'Strong',
      'Good',
      'Fair',
      'Weak',
    ]);
  });
});

describe('parkedSegments', () => {
  it('shows Gear Guard and outlets as distinct segments', () => {
    const segments = parkedSegments({ climate: 0.5, system: 1.6, gearGuard: 0.2, outlets: 0.1 });
    expect(segments.map((s) => [s.label, s.kwh])).toEqual([
      ['System', 1.6],
      ['Climate', 0.5],
      ['Gear Guard', 0.2],
      ['Outlets', 0.1],
    ]);
    expect(new Set(segments.map((s) => s.color)).size).toBe(4);
    expect(
      parkedSegments({ climate: 0, system: 0, gearGuard: 0, outlets: 0.1 }).map((s) => s.label),
    ).toEqual(['Outlets']);
  });

  it('keeps the uses that drew energy, in legend order', () => {
    expect(
      parkedSegments({ climate: 0.4, system: 1.7, gearGuard: 0, outlets: 0 }).map((s) => [
        s.label,
        s.kwh,
      ]),
    ).toEqual([
      ['System', 1.7],
      ['Climate', 0.4],
    ]);
    expect(parkedSegments({ climate: 0, system: 0, gearGuard: 0, outlets: 0 })).toEqual([]);
  });
});

describe('parkedWeek', () => {
  const record = (day: string, kwh: number) => ({ day, kwh });
  const today = new Date(2026, 9, 10, 11, 0);
  const keys = (days: { key: string }[]) => days.map((d) => d.key);
  const energy = (days: { window: { kwh: number } | null }[]) =>
    days.map((d) => d.window?.kwh ?? null);

  it('lays out the seven full days before today, oldest first', () => {
    const days = parkedWeek([record('2026-10-09', 1.1)], 7, today);
    expect(keys(days)).toEqual([
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
    ]);
    expect(energy(days)).toEqual([null, null, null, null, null, null, 1.1]);
    expect(days.every((d) => d.date.getDate() === Number(d.key.slice(8)))).toBe(true);
  });

  it('keeps a day with no reading empty, its neighbours where they were', () => {
    const days = parkedWeek([record('2026-10-05', 1.1), record('2026-10-08', 0.4)], 7, today);
    expect(energy(days)).toEqual([null, null, 1.1, null, null, 0.4, null]);
  });

  it('leaves out today and anything older than the week', () => {
    const days = parkedWeek([record('2026-10-10', 9), record('2026-10-02', 8)], 7, today);
    expect(energy(days).every((kwh) => kwh === null)).toBe(true);
  });

  it('crosses a month and a change of clocks by calendar days', () => {
    const days = parkedWeek([], 7, new Date(2026, 10, 3, 9));
    expect(keys(days)).toEqual([
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
  });
});
