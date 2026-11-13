import { describe, expect, it } from 'vitest';
import { dayWindow, nightOf } from './parked-energy-nights.js';

const window = (minutes: number, kwh = 1) => ({
  minutes,
  kwh,
  rangeKm: 5,
  uses: { climate: 0.2, system: 0.8, gearGuard: 0, outlets: 0 },
});

describe('dayWindow', () => {
  it('takes the rolling 24 hours out of the windows a payload carries', () => {
    expect(dayWindow([window(1440, 1.1), window(480, 0.4)])?.kwh).toBe(1.1);
  });

  it('prefers the 24 hours over a park that has run longer, wherever it sits', () => {
    expect(dayWindow([window(5040, 9), window(1440, 1.1)])?.kwh).toBe(1.1);
    expect(dayWindow([window(1440, 1.1), window(5040, 9)])?.kwh).toBe(1.1);
  });

  it('records nothing from a payload with no day to record', () => {
    expect(dayWindow([window(480, 0.4), window(111, 0.1)])).toBeNull();
    expect(dayWindow([])).toBeNull();
  });
});

describe('nightOf', () => {
  it('gives a report at local midnight to the night it closes', () => {
    // 00:00 on the 8th in New York, and a millisecond past it.
    expect(nightOf(new Date('2026-10-08T04:00:00.000Z'), 'America/New_York')).toBe('2026-10-07');
    expect(nightOf(new Date('2026-10-08T04:00:00.001Z'), 'America/New_York')).toBe('2026-10-08');
  });

  it("reads the day in the reader's calendar, not the server's", () => {
    const at = new Date('2026-10-08T23:30:00.000Z');
    expect(nightOf(at, 'America/New_York')).toBe('2026-10-08');
    expect(nightOf(at, 'Europe/Berlin')).toBe('2026-10-09');
    expect(nightOf(at, 'UTC')).toBe('2026-10-08');
  });
});
