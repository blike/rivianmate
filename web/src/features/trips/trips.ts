import type {
  ChargingSessionDto,
  DriveDto,
  TripActivityRef,
  TripAssignmentDto,
  TripDto,
  TripStatsDto,
} from '@server/api-types';
import { formatMoney } from '../../lib/charging';
import { groupByDay, localKey } from '../../lib/drives';
import { longDate, shortDate } from '../../lib/format';
import { haversineKm } from '../../lib/geo';
import { chargeStart } from '../charging/sessions';

/** Time parked between drives shorter than this isn't worth a line of its own. */
const MIN_STOP_MS = 15 * 60_000;
/** A stop this long that reaches the small hours was a night there, not a late charge. */
const MIN_NIGHT_MS = 4 * 3600_000;
const NIGHT_HOUR = 3;
/**
 * A drive ending farther than this from where the next one starts means
 * driving between them that isn't in the trip: taken out, or never recorded.
 * Wide enough for GPS drift across a car park.
 */
const MISSING_KM = 0.5;

/** Whether driving between these two, one after the other, is missing from the trip. */
export function missingBetween(a: DriveDto, b: DriveDto): boolean {
  if (a.endLat == null || a.endLon == null || b.startLat == null || b.startLon == null) {
    return false;
  }
  return haversineKm(a.endLat, a.endLon, b.startLat, b.startLon) > MISSING_KM;
}

export type TimelineEntry =
  | { kind: 'drive'; startedAt: string; drive: DriveDto }
  /** A charge before the first drive or after the last. */
  | { kind: 'charge'; startedAt: string; session: ChargingSessionDto }
  /** Parked between two drives, with any charges it held. */
  | {
      kind: 'stop';
      startedAt: string;
      endedAt: string;
      /** Where the drive before it ended. */
      place: string | null;
      /** Nights spent there, in the viewer's time zone. */
      nights: number;
      charges: ChargingSessionDto[];
    }
  /**
   * Between two drives that don't meet: the trip has no record of getting
   * from one to the other, so it's not taken as parked. Any charges in it
   * follow as charges of their own.
   */
  | {
      kind: 'missing';
      startedAt: string;
      endedAt: string;
      /** Where the drive before ended, and where the next began. */
      from: string | null;
      to: string | null;
    };

/** The evenings, as YYYY-MM-DD, whose nights a stop spans; none for a short stop. */
export function stopNightDates(from: string, to: string): string[] {
  const start = new Date(from);
  const end = new Date(to);
  if (end.getTime() - start.getTime() < MIN_NIGHT_MS) return [];
  const night = new Date(start);
  night.setHours(NIGHT_HOUR, 0, 0, 0);
  if (night < start) night.setDate(night.getDate() + 1);
  const evenings: string[] = [];
  // By calendar day, not 24 hours, so a clock change doesn't shift it.
  while (night <= end) {
    const evening = new Date(night);
    evening.setDate(evening.getDate() - 1);
    evenings.push(localKey(evening));
    night.setDate(night.getDate() + 1);
  }
  return evenings;
}

/** Earliest first, by when each started. */
export const byStart = <T extends { startedAt: string }>(a: T, b: T) =>
  Date.parse(a.startedAt) - Date.parse(b.startedAt);
export const sortedByStart = <T extends { startedAt: string }>(items: readonly T[]) =>
  [...items].sort(byStart);

/** A YYYY-MM-DD day as shown: "Jun 2". */
export const dayLabel = (key: string) => shortDate(dayStart(key).getTime());

/** A stop's nights: "Overnight", "3 nights". */
export const overnightLabel = (nights: number) => (nights === 1 ? 'Overnight' : `${nights} nights`);

/**
 * Everything in order. Stops aren't stored: each is the time between one
 * drive and the next, and a charge belongs to the gap it charged in, placed
 * by when it charged, as on the charging page, not when it was plugged in.
 */
export function timelineEntries(
  drives: readonly DriveDto[],
  sessions: readonly ChargingSessionDto[],
): TimelineEntry[] {
  const sorted = [...drives].sort(byStart);
  const charged = (s: ChargingSessionDto) => Date.parse(chargeStart(s));
  const charges = [...sessions].sort((a, b) => charged(a) - charged(b));
  const startOf = (a: { startedAt: string }) => Date.parse(a.startedAt);
  const chargeEntry = (session: ChargingSessionDto): TimelineEntry => ({
    kind: 'charge',
    startedAt: chargeStart(session),
    session,
  });
  const entries: TimelineEntry[] = [];
  const first = sorted[0];
  for (const session of charges) {
    if (!first || charged(session) < startOf(first)) entries.push(chargeEntry(session));
  }
  sorted.forEach((drive, i) => {
    entries.push({ kind: 'drive', startedAt: drive.startedAt, drive });
    const next = sorted[i + 1];
    const inGap = charges.filter(
      (s) => charged(s) >= startOf(drive) && (!next || charged(s) < startOf(next)),
    );
    if (!next) {
      for (const session of inGap) entries.push(chargeEntry(session));
      return;
    }
    const from = drive.endedAt ?? drive.startedAt;
    if (missingBetween(drive, next)) {
      entries.push({
        kind: 'missing',
        startedAt: from,
        endedAt: next.startedAt,
        from: drive.end?.label ?? null,
        to: next.start?.label ?? null,
      });
      for (const session of inGap) entries.push(chargeEntry(session));
      return;
    }
    if (inGap.length === 0 && startOf(next) - Date.parse(from) < MIN_STOP_MS) return;
    entries.push({
      kind: 'stop',
      startedAt: from,
      endedAt: next.startedAt,
      place: drive.end?.label ?? null,
      nights: stopNightDates(from, next.startedAt).length,
      charges: inGap,
    });
  });
  return entries;
}

/** The timeline by the local day each entry started, oldest first. */
export function timelineDays(
  drives: readonly DriveDto[],
  sessions: readonly ChargingSessionDto[],
  now = new Date(),
) {
  return groupByDay(timelineEntries(drives, sessions), now);
}

/** The start of a YYYY-MM-DD day, or its last moment, in the viewer's time zone. */
export const dayStart = (date: string) => new Date(`${date}T00:00:00`);
export const dayEnd = (date: string) => new Date(`${date}T23:59:59.999`);

/** "Jun 1, 2026 – Jun 5, 2026": the dates set, else what the activities span. */
export function tripDates(
  trip: Pick<TripDto, 'startDate' | 'endDate'> & {
    stats: Pick<TripStatsDto, 'startedAt' | 'lastStartedAt'>;
  },
): string | null {
  const label = (date: string | null, at: string | null) =>
    date ? longDate(dayStart(date).getTime()) : at ? longDate(at) : null;
  const from = label(trip.startDate, trip.stats.startedAt);
  const to = label(trip.endDate, trip.stats.lastStartedAt);
  if (!from || !to) return from ?? to;
  return from === to ? from : `${from} – ${to}`;
}

/** The dates as shown: "Since Oct 28, 2026" for a trip under way with no end yet. */
export function tripDateLabel(
  trip: Pick<TripDto, 'startDate' | 'endDate'> & {
    stats: Pick<TripStatsDto, 'startedAt' | 'lastStartedAt'>;
  },
): string | null {
  if (trip.startDate && !trip.endDate) {
    return `Since ${longDate(dayStart(trip.startDate).getTime())}`;
  }
  return tripDates(trip);
}

/** A trip's dates as a calendar page: "Jun" over "12–14" over "2026". */
export function tripCalendar(
  trip: Pick<TripDto, 'startDate' | 'endDate'> & {
    stats: Pick<TripStatsDto, 'startedAt' | 'lastStartedAt'>;
  },
): { month: string; days: string; year: string } | null {
  const day = (date: string | null, at: string | null) =>
    date ? dayStart(date) : at ? new Date(at) : null;
  const from = day(trip.startDate, trip.stats.startedAt);
  const to = day(trip.endDate, trip.stats.lastStartedAt) ?? from;
  if (!from || !to) return null;
  const month = (d: Date) => d.toLocaleDateString(undefined, { month: 'short' });
  const sameYear = from.getFullYear() === to.getFullYear();
  const sameMonth = sameYear && from.getMonth() === to.getMonth();
  const sameDay = sameMonth && from.getDate() === to.getDate();
  return {
    month: sameMonth ? month(from) : `${month(from)} – ${month(to)}`,
    days: sameDay ? `${from.getDate()}` : `${from.getDate()}–${to.getDate()}`,
    year: sameYear
      ? `${from.getFullYear()}`
      : `${from.getFullYear()}–${String(to.getFullYear()).slice(-2)}`,
  };
}

/** Whole days from one YYYY-MM-DD to another, by the calendar, not 24 hours. */
export function daysBetween(from: string, to: string): number {
  const [a, b] = [from, to].map((d) => {
    const [y, m, day] = d.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, day);
  }) as [number, number];
  return Math.round((b - a) / 86_400_000);
}

export type OpenPhase =
  /** Kept open, and its first day hasn't come. */
  | { kind: 'upcoming'; inDays: number }
  /** Kept open, and today is one of its days. */
  | { kind: 'live'; day: number; of: number | null };

/** Where a trip with dates stands today; null without dates, or once its days are over. */
export function openPhase(
  trip: Pick<TripDto, 'startDate' | 'endDate'>,
  today = localKey(new Date()),
): OpenPhase | null {
  if (!trip.startDate) return null;
  if (trip.startDate > today)
    return { kind: 'upcoming', inDays: daysBetween(today, trip.startDate) };
  if (trip.endDate != null && trip.endDate < today) return null;
  return {
    kind: 'live',
    day: daysBetween(trip.startDate, today) + 1,
    of: trip.endDate ? daysBetween(trip.startDate, trip.endDate) + 1 : null,
  };
}

/** The local day `days` after (or before) a "YYYY-MM-DD" one. */
export function addDays(date: string, days: number): string {
  const d = dayStart(date);
  d.setDate(d.getDate() + days);
  return localKey(d);
}

type TripDates = Pick<TripDto, 'id' | 'startDate' | 'endDate'>;

/**
 * The trip with dates whose days share one with these, if any: two would both
 * claim what's driven on it. A trip with no end runs on without limit.
 */
export function overlappingTrip<T extends TripDates>(
  trips: readonly T[],
  dates: { id: number | null; startDate: string; endDate: string | null },
): T | undefined {
  return trips.find(
    (t) =>
      t.id !== dates.id &&
      t.startDate != null &&
      t.startDate <= (dates.endDate ?? '9999-12-31') &&
      dates.startDate <= (t.endDate ?? '9999-12-31'),
  );
}

/** "Day 3 of 5", "Day 3", "Starts tomorrow", "Starts in 4 days". */
export function phaseLabel(phase: OpenPhase): string {
  if (phase.kind === 'live')
    return phase.of ? `Day ${phase.day} of ${phase.of}` : `Day ${phase.day}`;
  return phase.inDays === 1 ? 'Starts tomorrow' : `Starts in ${phase.inDays} days`;
}

/**
 * A trip's dates widened to take in a day, or null if they already do. A trip
 * is its dates, so what's put in it has to fall within them; one without
 * dates holds whatever's put in it.
 */
export function widenedTo(
  trip: Pick<TripDto, 'startDate' | 'endDate'>,
  day: string,
): { startDate: string; endDate: string | null } | null {
  if (!trip.startDate) return null;
  const { startDate, endDate } = trip;
  if (startDate <= day && (endDate == null || day <= endDate)) return null;
  return {
    startDate: day < startDate ? day : startDate,
    endDate: endDate != null && day > endDate ? day : endDate,
  };
}

/** Whether an activity falls outside the dates set for its trip. */
export function outsideDates(
  startedAt: string,
  trip: Pick<TripDto, 'startDate' | 'endDate'>,
): boolean {
  const day = localKey(startedAt);
  return (
    (trip.startDate != null && day < trip.startDate) || (trip.endDate != null && day > trip.endDate)
  );
}

/**
 * What it cost, a total per currency: "≈ $40.00 + CAD 12.00"; null when nothing's
 * known. `marked: false` leaves estimates unmarked, for a card's glance.
 */
export function costsLabel(
  costs: TripStatsDto['costs'],
  { marked = true }: { marked?: boolean } = {},
): string | null {
  if (costs.length === 0) return null;
  return costs
    .map((c) => `${marked && c.estimated ? '≈ ' : ''}${formatMoney(String(c.amount), c.currency)}`)
    .join(' + ');
}

/** "7 of 9 drives" when a figure doesn't cover them all; otherwise null. */
export function coverage(have: number, total: number, noun: string): string | null {
  return have < total ? `${have} of ${total} ${noun}` : null;
}

export const activityKey = (a: TripActivityRef) => `${a.kind}:${a.id}`;

/** Finds which other trip, if any, an activity is in. */
export function otherTrip(
  assignments: readonly TripAssignmentDto[],
  activity: TripActivityRef,
  tripId: number,
): TripAssignmentDto | null {
  return (
    assignments.find(
      (a) => a.kind === activity.kind && a.activityId === activity.id && a.tripId !== tripId,
    ) ?? null
  );
}

/** An activity in the trip builder's list. */
export interface BuilderRow {
  ref: TripActivityRef;
  startedAt: string;
  /** Where a drive set out from and arrived, as home or not; null for a charge. */
  startsHome: boolean | null;
  endsHome: boolean | null;
  distanceKm: number | null;
  /** In another trip: left out unless ticked. */
  assigned: boolean;
}

/** The viewer's ticks, against what the dates take in by default. */
export interface BuilderPicks {
  /** Free rows the viewer unticked. */
  removed: readonly string[];
  /** Rows in another trip the viewer ticked. */
  added: readonly string[];
}

export const NO_PICKS: BuilderPicks = { removed: [], added: [] };

const chronological = (rows: readonly BuilderRow[]) => sortedByStart(rows);

/** Rows that started on the days from–to, both included, in the viewer's time zone. */
export function rowsBetween<T extends { startedAt: string }>(
  rows: readonly T[],
  from: string,
  to: string,
): T[] {
  return rows.filter((r) => {
    const day = localKey(r.startedAt);
    return day >= from && day <= to;
  });
}

/** What's chosen: every free row, less the ones unticked, plus any ticked from another trip. */
export function chosenKeys(rows: readonly BuilderRow[], picks: BuilderPicks): Set<string> {
  const chosen = new Set<string>();
  for (const row of rows) {
    const key = activityKey(row.ref);
    if (row.assigned ? picks.added.includes(key) : !picks.removed.includes(key)) chosen.add(key);
  }
  return chosen;
}

/** Ticks or unticks a row. */
export function toggleRow(picks: BuilderPicks, row: BuilderRow, on: boolean): BuilderPicks {
  const key = activityKey(row.ref);
  const without = (keys: readonly string[]) => keys.filter((k) => k !== key);
  if (row.assigned) {
    return { ...picks, added: on ? [...without(picks.added), key] : without(picks.added) };
  }
  return { ...picks, removed: on ? without(picks.removed) : [...without(picks.removed), key] };
}

/**
 * The day the journey came home, when it set out on `from`: the run away
 * from home that begins with that day's first drive out of it.
 */
export function homecoming(rows: readonly BuilderRow[], from: string): string | null {
  const order = chronological(rows);
  const start =
    order.find((r) => localKey(r.startedAt) === from && r.startsHome) ??
    order.find((r) => localKey(r.startedAt) >= from);
  if (!start) return null;
  const run = awayRun(rows, activityKey(start.ref));
  const last = run && order.find((r) => activityKey(r.ref) === run.last);
  return last ? localKey(last.startedAt) : null;
}

/**
 * The whole time away from home around a row: back to the drive that left
 * home, on to the drive that returned. Null when home isn't known around it,
 * or the row itself is a drive that's neither.
 */
export function awayRun(
  rows: readonly BuilderRow[],
  key: string,
): { first: string; last: string } | null {
  const order = chronological(rows);
  const at = order.findIndex((r) => activityKey(r.ref) === key);
  if (at < 0) return null;
  let first = -1;
  for (let i = at; i >= 0; i--) {
    if (order[i]!.startsHome) {
      first = i;
      break;
    }
    // Arriving home before the row means this run began after it.
    if (i < at && order[i]!.endsHome) break;
  }
  let last = -1;
  for (let i = Math.max(at, first); i < order.length; i++) {
    if (order[i]!.endsHome) {
      last = i;
      break;
    }
    if (i > at && order[i]!.startsHome) break;
  }
  if (first < 0 || last < 0 || first === last) return null;
  return { first: activityKey(order[first]!.ref), last: activityKey(order[last]!.ref) };
}
