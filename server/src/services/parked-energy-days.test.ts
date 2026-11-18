import { describe, expect, it } from 'vitest';
import { b64, float, int, message } from '../testing/protobuf.js';
import { dayWindow, parkedDays } from './parked-energy-days.js';

const window = (minutes: number, kwh = 1) => ({
  minutes,
  kwh,
  rangeKm: 5,
  uses: { climate: 0.2, system: 0.8, gearGuard: 0, outlets: 0 },
});

/** A parked-energy payload carrying the 24 hours, the 8 hours and this park. */
const payload = (day: number, eight = 0.25, park?: [minutes: number, kwh: number]) =>
  b64([
    ...message(1, [...float(1, day), ...float(2, 0.5), ...float(4, 1), ...int(11, 1440)]),
    ...message(2, [...float(1, eight), ...int(11, 480)]),
    ...(park ? message(3, [...float(1, park[1]), ...int(11, park[0])]) : []),
  ]);

const at = (iso: string, kwh: number) => ({ at: new Date(iso), payload: payload(kwh) });
const NY = 'America/New_York';

describe('dayWindow', () => {
  it('takes the rolling 24 hours out of the windows a payload carries', () => {
    expect(dayWindow([window(1440, 1.1), window(480, 0.4)])?.kwh).toBe(1.1);
  });

  it('prefers the 24 hours over a park that has run longer, wherever it sits', () => {
    expect(dayWindow([window(5040, 9), window(1440, 1.1)])?.kwh).toBe(1.1);
    expect(dayWindow([window(1440, 1.1), window(5040, 9)])?.kwh).toBe(1.1);
  });

  it('gives nothing from a payload with no day in it', () => {
    expect(dayWindow([window(480, 0.4), window(111, 0.1)])).toBeNull();
    expect(dayWindow([])).toBeNull();
  });
});

describe('parkedDays', () => {
  // Noon on Oct 10 in New York.
  const now = new Date('2026-10-10T16:00:00Z');

  it("keeps each day's last reading, not its first", () => {
    const days = parkedDays(
      [
        at('2026-10-09T14:40:00Z', 1.5), // 10:40
        at('2026-10-09T22:00:00Z', 2), // 18:00
        at('2026-10-10T01:15:00Z', 2.5), // 21:15, the day's last
      ],
      7,
      NY,
      now,
    );
    expect(days).toEqual([
      {
        day: '2026-10-09',
        at: '2026-10-10T01:15:00.000Z',
        minutes: 1440,
        kwh: 2.5,
        rangeKm: 0,
        uses: { climate: 0.5, system: 1, gearGuard: 0, outlets: 0 },
      },
    ]);
  });

  it('leaves today out: its last reading has not come', () => {
    const days = parkedDays([at('2026-10-10T14:00:00Z', 1)], 7, NY, now);
    expect(days).toEqual([]);
  });

  it('gives the full days asked for, oldest first, and nothing before them', () => {
    const messages = [2, 3, 4, 5, 6, 7, 8, 9].map((d) => at(`2026-10-0${d}T20:00:00Z`, d));
    const days = parkedDays(messages, 7, NY, now);
    expect(days.map((d) => d.day)).toEqual([
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
    ]);
    expect(days.map((d) => d.kwh)).toEqual([3, 4, 5, 6, 7, 8, 9]);
  });

  it('leaves a day with no reading out, rather than closing the gap', () => {
    const days = parkedDays(
      [at('2026-10-07T20:00:00Z', 1), at('2026-10-09T20:00:00Z', 2)],
      7,
      NY,
      now,
    );
    expect(days.map((d) => d.day)).toEqual(['2026-10-07', '2026-10-09']);
  });

  it('skips a payload without a 24-hour window', () => {
    const short = {
      at: new Date('2026-10-09T23:00:00Z'),
      payload: b64(message(2, [...float(1, 0.5), ...int(11, 480)])),
    };
    const days = parkedDays([at('2026-10-09T20:00:00Z', 1), short], 7, NY, now);
    expect(days.map((d) => [d.day, d.kwh])).toEqual([['2026-10-09', 1]]);
  });

  it('gives a reading at local midnight to the day it closes', () => {
    const days = parkedDays(
      [at('2026-10-09T04:00:00.000Z', 1), at('2026-10-09T04:00:00.001Z', 2)],
      7,
      NY,
      now,
    );
    expect(days.map((d) => [d.day, d.kwh])).toEqual([
      ['2026-10-08', 1],
      ['2026-10-09', 2],
    ]);
  });

  it("reads the days in the reader's zone", () => {
    // 22:00 on the 8th in New York; already the 9th in Berlin.
    const messages = [at('2026-10-09T02:00:00Z', 1)];
    expect(parkedDays(messages, 7, NY, now)[0]?.day).toBe('2026-10-08');
    expect(parkedDays(messages, 7, 'Europe/Berlin', now)[0]?.day).toBe('2026-10-09');
  });

  it('counts back by calendar days across a change of clocks', () => {
    // US clocks go back on Nov 1, 2026; a week back from Nov 4 still starts Oct 28.
    const after = new Date('2026-11-04T17:00:00Z');
    const messages = [
      at('2026-10-27T23:00:00Z', 1),
      at('2026-10-28T23:00:00Z', 2),
      at('2026-11-01T23:00:00Z', 3),
      at('2026-11-03T23:00:00Z', 4),
    ];
    expect(parkedDays(messages, 7, NY, after).map((d) => d.day)).toEqual([
      '2026-10-28',
      '2026-11-01',
      '2026-11-03',
    ]);
  });

  it('takes the 24 hours, not this park, when the park has run longer', () => {
    const long = { at: new Date('2026-10-09T20:00:00Z'), payload: payload(1, 0.25, [2000, 3]) };
    expect(parkedDays([long], 7, NY, now)[0]).toMatchObject({ minutes: 1440, kwh: 1 });
  });
});
