import { describe, expect, it } from 'vitest';
import {
  activityBands,
  distanceByPeriod,
  tripLines,
  periodSummary,
  positionAt,
  rangeWindow,
  stateRows,
  stateTotals,
} from './history';

const H = 3600_000;
const at = (h: number) => new Date(Date.UTC(2026, 9, 1) + h * H).toISOString();
const from = Date.parse(at(0));
const to = Date.parse(at(48));

const drive = (
  start: number,
  end: number | null,
  km: number | null,
  kwh: number | null = null,
) => ({
  startedAt: at(start),
  endedAt: end == null ? null : at(end),
  distanceKm: km,
  energyKwh: kwh,
});
const session = (
  start: number,
  end: number | null,
  kwh: number | null,
  cost: string | null = null,
  estimatedCost: string | null = null,
) => ({
  startedAt: at(start),
  endedAt: end == null ? null : at(end),
  energyKwh: kwh,
  cost,
  estimatedCost,
  currency: 'USD',
});

describe('periodSummary', () => {
  it('totals what started in the window', () => {
    const s = periodSummary(
      [drive(-5, -4, 100), drive(2, 3, 40, 10), drive(10, 10.5, 20), drive(47, null, 5)],
      [session(-2, 1, 30, '9.00'), session(20, 26, 50, null, '6.50'), session(30, 31, 20, '4.25')],
      from,
      to,
    );
    expect(s).toEqual({
      distanceKm: 65,
      drives: 3,
      drivingSeconds: 3600 + 1800 + 3600,
      // Only the drive with an energy figure counts toward efficiency.
      energyKwh: 10,
      energyDistanceKm: 40,
      chargedKwh: 70,
      sessions: 2,
      cost: 10.75,
      costEstimated: true,
      currency: 'USD',
    });
  });
});

describe('activityBands', () => {
  it('clips spans to the window and runs open drives to now', () => {
    const spans = [
      { kind: 'plugged' as const, from: at(-3), to: at(-1) },
      { kind: 'charging' as const, from: at(-1), to: at(1) },
    ];
    expect(activityBands([drive(2, 3, 40), drive(47, null, 5)], spans, from, to, to)).toEqual([
      { kind: 'charging', from, to: Date.parse(at(1)) },
      { kind: 'drive', from: Date.parse(at(2)), to: Date.parse(at(3)) },
      { kind: 'drive', from: Date.parse(at(47)), to },
    ]);
  });
});

describe('distanceByPeriod', () => {
  it('buckets distance by the hour each drive started', () => {
    const buckets = distanceByPeriod(
      [drive(2.5, 3, 40), drive(2.8, 3, 2), drive(5, 6, 10), drive(-1, 0, 99)],
      from,
      from + 6 * H,
      'hour',
    );
    expect(buckets.map((b) => b.km)).toEqual([0, 0, 42, 0, 0, 10, 0]);
  });

  it('includes every day in the window', () => {
    expect(distanceByPeriod([], from, to, 'day').length).toBeGreaterThanOrEqual(2);
  });
});

describe('positionAt', () => {
  const points = [
    { ts: 10, lat: 1, lon: 1 },
    { ts: 20, lat: 2, lon: 2 },
    { ts: 30, lat: 3, lon: 3 },
  ];

  it('takes the last fix at or before the time', () => {
    expect(positionAt(points, 20)).toEqual([2, 2]);
    expect(positionAt(points, 29)).toEqual([2, 2]);
    expect(positionAt(points, 99)).toEqual([3, 3]);
  });

  it('is unknown before the first fix', () => {
    expect(positionAt(points, 5)).toBeNull();
    expect(positionAt([], 5)).toBeNull();
  });
});

describe('rangeWindow', () => {
  const now = new Date(2026, 9, 11, 14, 30);

  it('starts a range of days at local midnight, counting today', () => {
    const { from, to } = rangeWindow(24 * 7, now);
    expect(from).toEqual(new Date(2026, 9, 5));
    expect(to).toBe(now);
    expect(distanceByPeriod([], from.getTime(), to.getTime(), 'day')).toHaveLength(7);
  });

  it('keeps 24 hours rolling', () => {
    expect(rangeWindow(24, now).from).toEqual(new Date(2026, 9, 10, 14, 30));
  });
});

describe('stateRows', () => {
  // Local times, since day rows start at local midnight.
  const local = (day: number, h: number) => new Date(2026, 9, day, h).getTime();
  const span = (state: 'awake' | 'asleep' | 'driving', a: number, b: number) => ({
    state,
    from: new Date(a).toISOString(),
    to: new Date(b).toISOString(),
  });

  it('splits a span across the days it covers', () => {
    const rows = stateRows(
      [span('asleep', local(1, 22), local(2, 7))],
      local(1, 9),
      local(2, 12),
      true,
    );
    expect(rows.map((r) => r.from)).toEqual([local(1, 0), local(2, 0)]);
    expect(rows[0]!.segments).toEqual([{ state: 'asleep', from: local(1, 22), to: local(2, 0) }]);
    expect(rows[1]!.segments).toEqual([{ state: 'asleep', from: local(2, 0), to: local(2, 7) }]);
  });

  it('keeps one row over the window when not by day', () => {
    const rows = stateRows(
      [span('awake', local(1, 8), local(1, 9)), span('driving', local(1, 9), local(1, 10))],
      local(1, 6),
      local(2, 6),
      false,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ from: local(1, 6), to: local(2, 6) });
    expect(rows[0]!.segments.map((s) => s.state)).toEqual(['awake', 'driving']);
  });
});

describe('stateTotals', () => {
  it('adds up time per state', () => {
    const totals = stateTotals([
      { state: 'asleep', from: at(0), to: at(8) },
      { state: 'awake', from: at(8), to: at(9) },
      { state: 'asleep', from: at(9), to: at(10) },
    ]);
    expect(totals.get('asleep')).toBe(9 * H);
    expect(totals.get('awake')).toBe(H);
    expect(totals.has('driving')).toBe(false);
  });
});

describe('tripLines', () => {
  it('makes one line per drive, leaving out parked points', () => {
    const pt = (lat: number, driveId: number | null) => ({ lat, lon: 0, driveId });
    expect(tripLines([pt(1, null), pt(2, 7), pt(3, 7), pt(4, null), pt(5, 8), pt(6, 8)])).toEqual([
      [
        [2, 0],
        [3, 0],
      ],
      [
        [5, 0],
        [6, 0],
      ],
    ]);
  });
});
