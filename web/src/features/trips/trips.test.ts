import type { ChargingSessionDto, DriveDto, TripAssignmentDto } from '@server/api-types';
import { describe, expect, it } from 'vitest';
import { localKey } from '../../lib/drives';
import { drives, sessions } from '../../testing/fixtures';
import {
  awayRun,
  chosenKeys,
  homecoming,
  NO_PICKS,
  rowsBetween,
  toggleRow,
  tripCalendar,
  type BuilderRow,
  coverage,
  missingBetween,
  otherTrip,
  outsideDates,
  stopNightDates,
  timelineDays,
  timelineEntries,
  tripDates,
  daysBetween,
  openPhase,
  overlappingTrip,
  phaseLabel,
  tripDateLabel,
  widenedTo,
} from './trips';

describe('overlappingTrip', () => {
  const trip = (id: number, startDate: string | null, endDate: string | null) => ({
    id,
    startDate,
    endDate,
  });
  const running = trip(1, '2026-06-01', null);

  it('finds a trip that shares a day, one with no end running on', () => {
    const dates = { id: null, startDate: '2026-07-01', endDate: '2026-07-03' };
    expect(overlappingTrip([running], dates)).toBe(running);
    expect(overlappingTrip([trip(2, '2026-07-03', '2026-07-05')], dates)?.id).toBe(2);
    expect(overlappingTrip([trip(2, '2026-07-04', null)], dates)).toBeUndefined();
    expect(overlappingTrip([{ ...running, endDate: '2026-06-30' }], dates)).toBeUndefined();
  });

  it('ignores itself and trips without dates', () => {
    const dates = { id: 1, startDate: '2026-06-05', endDate: null };
    expect(overlappingTrip([running], dates)).toBeUndefined();
    expect(overlappingTrip([trip(2, null, null)], dates)).toBeUndefined();
  });
});

/** A local time, so these hold in whatever zone the tests run. */
const local = (day: number, hour: number, minute = 0) =>
  new Date(2026, 5, day, hour, minute).toISOString();

const drive = (id: number, startedAt: string, endedAt: string, end = 'Hotel') =>
  ({
    ...drives[0],
    id,
    startedAt,
    endedAt,
    end: { label: end, address: null, isHome: false, locationId: null, unnamed: false },
  }) as DriveDto;
const charge = (id: number, startedAt: string, endedAt: string) =>
  ({
    ...sessions[0],
    id,
    startedAt,
    endedAt,
    chargingStartedAt: null,
    chargingEndedAt: null,
  }) as ChargingSessionDto;

describe('stopNightDates', () => {
  it('counts a night parked, but not an evening or a long day', () => {
    expect(stopNightDates(local(1, 18), local(2, 8))).toHaveLength(1);
    expect(stopNightDates(local(1, 18), local(1, 23))).toHaveLength(0);
    expect(stopNightDates(local(1, 9), local(1, 17))).toHaveLength(0);
  });

  it('doesn’t call a short stop in the small hours a night', () => {
    expect(stopNightDates(local(2, 1), local(2, 4))).toHaveLength(0);
  });

  it('counts each night of a longer stay', () => {
    expect(stopNightDates(local(1, 18), local(4, 8))).toHaveLength(3);
  });

  it('counts by the calendar across a clock change', () => {
    // US DST ended Nov 1, 2026; a 25-hour day mustn't lose or add a night.
    const from = new Date(2026, 9, 31, 18).toISOString();
    const to = new Date(2026, 10, 2, 8).toISOString();
    expect(stopNightDates(from, to)).toHaveLength(2);
  });
});

describe('timelineEntries', () => {
  it('orders drives, stops and charges, nesting a charge in the stop it fell in', () => {
    const entries = timelineEntries(
      [drive(2, local(2, 8), local(2, 10)), drive(1, local(1, 9), local(1, 17))],
      [charge(1, local(1, 18), local(2, 6))],
    );
    expect(entries.map((e) => e.kind)).toEqual(['drive', 'stop', 'drive']);
    const stop = entries[1]!;
    if (stop.kind !== 'stop') throw new Error('expected a stop');
    expect(stop).toMatchObject({ place: 'Hotel', nights: 1, startedAt: local(1, 17) });
    expect(stop.charges.map((c) => c.id)).toEqual([1]);
  });

  it('skips a brief pause, but not one with a charge in it', () => {
    const d1 = drive(1, local(1, 9), local(1, 10));
    const d2 = drive(2, local(1, 10, 5), local(1, 11));
    expect(timelineEntries([d1, d2], []).map((e) => e.kind)).toEqual(['drive', 'drive']);
    expect(
      timelineEntries([d1, d2], [charge(1, local(1, 10, 1), local(1, 10, 4))]).map((e) => e.kind),
    ).toEqual(['drive', 'stop', 'drive']);
  });

  it('keeps charges before the first drive and after the last', () => {
    const entries = timelineEntries(
      [drive(1, local(2, 9), local(2, 10))],
      [charge(1, local(1, 22), local(2, 6)), charge(2, local(2, 12), local(2, 13))],
    );
    expect(entries.map((e) => e.kind)).toEqual(['charge', 'drive', 'charge']);
  });

  it('shows charges alone, and never drops one', () => {
    const entries = timelineEntries(
      [],
      [charge(2, local(2, 1), local(2, 2)), charge(1, local(1, 1), local(1, 2))],
    );
    expect(entries.map((e) => (e.kind === 'charge' ? e.session.id : null))).toEqual([1, 2]);
  });
});

describe('missing driving', () => {
  /** A drive from one spot to another, as [lat, lon]. */
  const between = (id: number, from: [number, number], to: [number, number], day = 1) => ({
    ...drive(id, local(day, 8 + id * 2), local(day, 9 + id * 2)),
    startLat: from[0],
    startLon: from[1],
    endLat: to[0],
    endLon: to[1],
  });
  const fresno: [number, number] = [36.74, -119.79];
  const merced: [number, number] = [37.3, -120.48];

  it('is where one drive ends away from where the next starts, allowing for GPS drift', () => {
    const out = between(1, merced, fresno);
    // About 100 m across the car park: the same spot.
    expect(missingBetween(out, between(2, [36.7409, -119.79], merced))).toBe(false);
    expect(missingBetween(out, between(2, merced, fresno))).toBe(true);
    // Without coordinates it can't be told, so it isn't assumed.
    expect(missingBetween(out, drive(2, local(1, 12), local(1, 13)))).toBe(false);
  });

  it('shows as not in the trip, not as a stop or a night, with its charges after it', () => {
    const entries = timelineEntries(
      [between(1, merced, fresno), between(2, merced, fresno, 2)],
      [charge(1, local(1, 20), local(1, 22))],
    );
    expect(entries.map((e) => e.kind)).toEqual(['drive', 'missing', 'charge', 'drive']);
    expect(entries[1]).toMatchObject({ from: 'Hotel', startedAt: local(1, 11) });
  });
});

describe('widenedTo', () => {
  it('stretches a trip’s dates to take in a day outside them', () => {
    const trip = { startDate: '2026-06-02', endDate: '2026-06-04' };
    expect(widenedTo(trip, '2026-06-03')).toBeNull();
    expect(widenedTo(trip, '2026-05-30')).toEqual({
      startDate: '2026-05-30',
      endDate: '2026-06-04',
    });
    expect(widenedTo(trip, '2026-06-07')).toEqual({
      startDate: '2026-06-02',
      endDate: '2026-06-07',
    });
    // Running on with no end, only an earlier day is outside it.
    expect(widenedTo({ startDate: '2026-06-02', endDate: null }, '2026-07-01')).toBeNull();
    expect(widenedTo({ startDate: null, endDate: null }, '2026-07-01')).toBeNull();
  });
});

describe('a charge’s day', () => {
  it('is when it charged, not when it was plugged in', () => {
    const late = {
      ...charge(1, local(1, 23, 50), local(2, 6)),
      chargingStartedAt: local(2, 0, 10),
    };
    const days = timelineDays([], [late]);
    expect(days.map((d) => d.key)).toEqual([localKey(local(2, 0, 10))]);
  });
});

describe('timelineDays', () => {
  it('groups a multi-day trip by local day, oldest first', () => {
    const days = timelineDays(
      [drive(1, local(1, 9), local(1, 17)), drive(2, local(2, 8), local(2, 10))],
      [],
      new Date(2026, 6, 1),
    );
    expect(days).toHaveLength(2);
    expect(days[0]!.items.map((e) => e.kind)).toEqual(['drive', 'stop']);
    expect(days[1]!.items.map((e) => e.kind)).toEqual(['drive']);
  });
});

describe('trip dates', () => {
  const stats = { startedAt: local(1, 9), lastStartedAt: local(3, 9) };

  it('prefers the dates set, per end, over what the activities span', () => {
    expect(tripDates({ startDate: null, endDate: null, stats })).toBe('Jun 1, 2026 – Jun 3, 2026');
    expect(tripDates({ startDate: '2026-05-30', endDate: null, stats })).toBe(
      'May 30, 2026 – Jun 3, 2026',
    );
    expect(tripDates({ startDate: '2026-06-01', endDate: '2026-06-01', stats })).toBe(
      'Jun 1, 2026',
    );
  });

  it('is null with nothing to go on', () => {
    expect(
      tripDates({
        startDate: null,
        endDate: null,
        stats: { startedAt: null, lastStartedAt: null },
      }),
    ).toBeNull();
  });

  it('flags an activity outside the dates set, by local day', () => {
    const trip = { startDate: '2026-06-02', endDate: '2026-06-03' };
    expect(outsideDates(local(1, 23), trip)).toBe(true);
    expect(outsideDates(local(2, 0), trip)).toBe(false);
    expect(outsideDates(local(3, 23), trip)).toBe(false);
    expect(outsideDates(local(4, 0), trip)).toBe(true);
    expect(outsideDates(local(1, 9), { startDate: null, endDate: null })).toBe(false);
  });
});

describe('coverage', () => {
  it('only speaks up about a gap', () => {
    expect(coverage(9, 9, 'drives')).toBeNull();
    expect(coverage(7, 9, 'drives')).toBe('7 of 9 drives');
  });
});

describe('additions', () => {
  const assignments: TripAssignmentDto[] = [
    { kind: 'drive', activityId: 1, tripId: 10, tripName: 'This' },
    { kind: 'drive', activityId: 2, tripId: 20, tripName: 'Other' },
  ];

  it('finds another trip, not this one, and tells a drive from a charge', () => {
    expect(otherTrip(assignments, { kind: 'drive', id: 2 }, 10)?.tripName).toBe('Other');
    expect(otherTrip(assignments, { kind: 'drive', id: 1 }, 10)).toBeNull();
    expect(otherTrip(assignments, { kind: 'charge', id: 2 }, 10)).toBeNull();
  });
});

describe('choosing a trip by its dates', () => {
  const row = (id: number, over: Partial<BuilderRow> = {}): BuilderRow => ({
    ref: { kind: 'drive', id },
    startedAt: local(id, 9),
    startsHome: false,
    endsHome: false,
    distanceKm: 10,
    assigned: false,
    ...over,
  });
  const rows = [row(1), row(2), row(3), row(4)];
  const chosen = (picks = NO_PICKS, from = rows) => [...chosenKeys(from, picks)].sort();

  it('takes the days between the dates, both included', () => {
    expect(rowsBetween(rows, '2026-06-02', '2026-06-03').map((r) => r.ref.id)).toEqual([2, 3]);
    expect(rowsBetween(rows, '2026-06-04', '2026-06-04').map((r) => r.ref.id)).toEqual([4]);
  });

  it('takes everything free, and lets each be ticked off and on again', () => {
    expect(chosen()).toEqual(['drive:1', 'drive:2', 'drive:3', 'drive:4']);
    const off = toggleRow(NO_PICKS, rows[1]!, false);
    expect(chosen(off)).toEqual(['drive:1', 'drive:3', 'drive:4']);
    expect(chosen(toggleRow(off, rows[1]!, true))).toEqual(chosen());
  });

  it('leaves what’s in another trip out until it’s ticked', () => {
    const taken = [row(1), row(2, { assigned: true })];
    expect(chosen(NO_PICKS, taken)).toEqual(['drive:1']);
    const on = toggleRow(NO_PICKS, taken[1]!, true);
    expect(chosen(on, taken)).toEqual(['drive:1', 'drive:2']);
    expect(chosen(toggleRow(on, taken[1]!, false), taken)).toEqual(['drive:1']);
  });

  it('finds the day it came home from the day it set out', () => {
    const trip = [
      row(1, { endsHome: true }),
      row(2, { startsHome: true }),
      row(3),
      row(5, { endsHome: true }),
      row(6, { startsHome: true }),
    ];
    expect(homecoming(trip, '2026-06-02')).toBe('2026-06-05');
    expect(homecoming([row(1), row(2)], '2026-06-01')).toBeNull();
    expect(homecoming(trip, '2026-06-09')).toBeNull();
  });

  it('finds the whole time away from home around a row', () => {
    const trip = [
      row(1, { endsHome: true }),
      row(2, { startsHome: true }),
      row(3),
      row(4),
      row(5, { endsHome: true }),
      row(6, { startsHome: true }),
    ];
    expect(awayRun(trip, 'drive:3')).toEqual({ first: 'drive:2', last: 'drive:5' });
    expect(awayRun(trip, 'drive:2')).toEqual({ first: 'drive:2', last: 'drive:5' });
  });

  it('offers no run when home isn’t known', () => {
    expect(awayRun([row(1), row(2), row(3)], 'drive:2')).toBeNull();
  });
});

describe('tripCalendar', () => {
  const at = (startDate: string | null, endDate: string | null) =>
    tripCalendar({ startDate, endDate, stats: { startedAt: null, lastStartedAt: null } });

  it('reads like a calendar page, however far the trip spans', () => {
    expect(at('2026-06-12', '2026-06-12')).toEqual({ month: 'Jun', days: '12', year: '2026' });
    expect(at('2026-06-12', '2026-06-14')).toEqual({ month: 'Jun', days: '12–14', year: '2026' });
    expect(at('2026-06-30', '2026-07-02')).toEqual({
      month: 'Jun – Jul',
      days: '30–2',
      year: '2026',
    });
    expect(at('2025-12-30', '2026-01-02')?.year).toBe('2025–26');
  });

  it('falls back to what the activities span, or nothing', () => {
    expect(
      tripCalendar({
        startDate: null,
        endDate: null,
        stats: { startedAt: local(1, 9), lastStartedAt: local(3, 9) },
      })?.days,
    ).toBe('1–3');
    expect(at(null, null)).toBeNull();
  });
});

describe('localKey', () => {
  it('writes an early year in four digits, so it reads back', () => {
    expect(localKey(new Date(2, 9, 10).setFullYear(2))).toBe('0002-10-10');
  });
});

describe('trips by their dates', () => {
  const trip = (startDate: string | null, endDate: string | null = null) => ({
    startDate,
    endDate,
  });

  it('counts days by the calendar', () => {
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
    // Over a clock change, still whole days.
    expect(daysBetween('2026-03-07', '2026-03-10')).toBe(3);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
  });

  it('is under way from its first day to its last', () => {
    expect(openPhase(trip('2026-06-02', '2026-06-04'), '2026-06-03')).toEqual({
      kind: 'live',
      day: 2,
      of: 3,
    });
    expect(openPhase(trip('2026-06-02'), '2026-06-12')).toEqual({
      kind: 'live',
      day: 11,
      of: null,
    });
    expect(openPhase(trip('2026-06-02', '2026-06-04'), '2026-06-05')).toBeNull();
    expect(openPhase(trip(null), '2026-06-03')).toBeNull();
  });

  it('counts down to a trip that hasn’t started', () => {
    const tomorrow = openPhase(trip('2026-06-04'), '2026-06-03')!;
    expect(phaseLabel(tomorrow)).toBe('Starts tomorrow');
    expect(phaseLabel(openPhase(trip('2026-06-10'), '2026-06-03')!)).toBe('Starts in 7 days');
    expect(phaseLabel({ kind: 'live', day: 2, of: 5 })).toBe('Day 2 of 5');
    expect(phaseLabel({ kind: 'live', day: 2, of: null })).toBe('Day 2');
  });

  it('shows a trip under way with no end as since its start', () => {
    const stats = { startedAt: null, lastStartedAt: null };
    const open = { startDate: '2026-10-28', endDate: null, stats };
    expect(tripDateLabel(open)).toMatch(/^Since Oct 28, 2026$/);
    expect(tripDateLabel({ ...open, endDate: '2026-11-02' })).toContain('–');
  });
});
