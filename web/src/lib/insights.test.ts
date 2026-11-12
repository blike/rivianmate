import { describe, expect, it } from 'vitest';
import {
  parkedNights,
  parkedSegments,
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

describe('parkedNights', () => {
  /** A window as the panel hands it over, with its own end when a source has one. */
  const window = (minutes: number, kwh: number, at?: string) => ({ minutes, kwh, at });
  const iso = (year: number, month: number, day: number, hour = 0, minute = 0) =>
    new Date(year, month - 1, day, hour, minute).toISOString();
  const keys = (nights: { key: string }[]) => nights.map((n) => n.key);
  const energy = (nights: { window: { kwh: number } | null }[]) =>
    nights.map((n) => n.window?.kwh ?? null);

  it('lays the week out in the device calendar, ending at the newest window', () => {
    const nights = parkedNights([window(1440, 1.1), window(480, 0.4)], iso(2026, 10, 8, 14));
    expect(keys(nights)).toEqual([
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
    ]);
    expect(nights.every((n) => n.date.getDate() === Number(n.key.slice(8)))).toBe(true);
  });

  it('gives a window ending at local midnight to the night it closes', () => {
    const nights = parkedNights(
      [window(1440, 1.1, iso(2026, 10, 8, 0, 0)), window(480, 0.4, iso(2026, 10, 8, 0, 1))],
      iso(2026, 10, 8, 0, 1),
    );
    // Midnight closes the 7th; a minute later opens the 8th.
    expect(energy(nights)).toEqual([null, null, null, null, null, 1.1, 0.4]);
  });

  it('keeps an empty slot for a night with nothing reported, without shifting the rest', () => {
    const nights = parkedNights(
      [window(1440, 1.1, iso(2026, 10, 3, 3)), window(480, 0.4)],
      iso(2026, 10, 5, 3),
    );
    expect(keys(nights)).toEqual([
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
    ]);
    expect(energy(nights)).toEqual([null, null, null, null, 1.1, null, 0.4]);
  });

  it('fills one night of seven when one window is all the source has', () => {
    const nights = parkedNights([window(1440, 1.1)], iso(2026, 10, 8, 14));
    expect(nights).toHaveLength(7);
    expect(nights.filter((n) => n.window).map((n) => n.key)).toEqual(['2026-10-08']);
  });

  it('keeps the shortest of the windows ending on one night, which nests inside the others', () => {
    const nights = parkedNights(
      [window(1440, 1.1), window(480, 0.4), window(111, 0.1)],
      iso(2026, 10, 8, 14),
    );
    expect(energy(nights)).toEqual([null, null, null, null, null, null, 0.1]);
  });

  it('has no week to draw without a report to hang it on', () => {
    expect(parkedNights([], '')).toEqual([]);
    expect(parkedNights([window(480, 0.4)], 'not a date')).toEqual([]);
  });
});
