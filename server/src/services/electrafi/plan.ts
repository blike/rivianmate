import type {
  ImportChargePreview,
  ImportItemStatus,
  ImportPreviewDto,
  ImportSessionAddition,
} from '../../api-types.js';
import { type Spot, nearbySpot } from '../locations.js';
import {
  type ChargeSegment,
  ChargeSegmenter,
  type DriveSegment,
  DriveSegmenter,
} from './segment.js';
import { type ReadStats, TimeZoneClock, readRows } from './parse.js';

/**
 * A row this close to a heartbeat is time RivianMate was already recording.
 * Heartbeats come at most every 15 minutes while state is arriving.
 */
const COVERED_MS = 20 * 60_000;
/** How far an odometer may disagree with the mileage recorded around it. */
const ODOMETER_SLACK_M = 1000;
/** A row later than this past now has the wrong time zone. */
const FUTURE_SLACK_MS = 5 * 60_000;

export interface Scan extends ReadStats {
  rows: number;
  firstAt: number | null;
  lastAt: number | null;
  firstMileage: { at: number; value: number } | null;
  lastMileage: { at: number; value: number } | null;
  drives: DriveSegment[];
  charges: ChargeSegment[];
  /** When each row with readings was taken, so a new date range needn't read the files again. */
  readingTimes: number[];
}

/** What's already stored for the vehicle. */
export interface Existing {
  /** Live and imported, in order. */
  heartbeats: readonly number[];
  /** When live recording last reported, or null if it never has. */
  lastLiveAt: number | null;
  drives: readonly { startedAt: number; endedAt: number | null }[];
  sessions: readonly {
    id: number;
    startedAt: number;
    endedAt: number | null;
    imported: boolean;
  }[];
  mileage: readonly { at: number; value: number }[];
}

export interface PlannedCharge {
  segment: ChargeSegment;
  /** The existing session it adds to; null makes a new one. */
  sessionId: number | null;
}

export interface Plan {
  from: number;
  to: number;
  drives: DriveSegment[];
  drivesRecorded: number;
  charges: PlannedCharge[];
  scope: RowScope;
  /** Each drive and charge starting in the range, and what happens to it. */
  driveDecisions: { segment: DriveSegment; status: ImportItemStatus }[];
  chargeDecisions: { segment: ChargeSegment; status: ImportItemStatus; sessionId: number | null }[];
}

type Span = readonly [number, number];

function inSpans(spans: readonly Span[], at: number): boolean {
  let lo = 0;
  let hi = spans.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const span = spans[mid]!;
    if (at < span[0]) hi = mid - 1;
    else if (at > span[1]) lo = mid + 1;
    else return true;
  }
  return false;
}

/** Merged and in order, so they can be searched. */
function mergeSpans(spans: readonly Span[]): Span[] {
  const merged: [number, number][] = [];
  for (const [start, end] of [...spans].sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

function nearAny(sorted: readonly number[], at: number, within: number): boolean {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < at) lo = mid + 1;
    else hi = mid;
  }
  const after = sorted[lo];
  const before = sorted[lo - 1];
  return (after != null && after - at <= within) || (before != null && at - before <= within);
}

/** Which rows an import takes, by time. */
export class RowScope {
  constructor(
    private readonly range: { from: number; to: number; lastLiveAt: number | null },
    private readonly heartbeats: readonly number[],
    private readonly recordedDrives: readonly Span[],
    private readonly kept: readonly Span[],
    private readonly charges: readonly Span[],
    private readonly dropped: readonly Span[],
  ) {}

  includes(at: number): boolean {
    // A drive being imported is taken whole, even across the end of the range.
    if (inSpans(this.kept, at)) return true;
    // Readings from a drive or charge that isn't imported would have nothing to belong to.
    if (inSpans(this.dropped, at)) return false;
    if (inSpans(this.recordedDrives, at) || nearAny(this.heartbeats, at, COVERED_MS)) return false;
    if (inSpans(this.charges, at)) return true;
    // Past the last live report, a stale import would hide what comes next.
    if (this.range.lastLiveAt != null && at > this.range.lastLiveAt) return false;
    return at >= this.range.from && at < this.range.to;
  }
}

/** Decides what an import of the range adds, leaving what's already stored alone. */
export function buildPlan(
  scan: Pick<Scan, 'drives' | 'charges'>,
  existing: Existing,
  range: { from: number; to: number },
  now: number,
): Plan {
  const recordedDrives = mergeSpans(
    existing.drives.map((d) => [d.startedAt, d.endedAt ?? now] as const),
  );
  const startsInRange = (startedAt: number) => startedAt >= range.from && startedAt < range.to;
  const isNewer = (startedAt: number) =>
    existing.lastLiveAt != null && startedAt > existing.lastLiveAt;
  const overlapsRecorded = (s: { startedAt: number; endedAt: number }) =>
    existing.drives.some((d) => d.startedAt <= s.endedAt && (d.endedAt ?? now) >= s.startedAt);

  const drives: DriveSegment[] = [];
  const dropped: Span[] = [];
  const driveDecisions: Plan['driveDecisions'] = [];
  for (const segment of scan.drives) {
    if (!startsInRange(segment.startedAt)) {
      dropped.push([segment.startedAt, segment.endedAt]);
      continue;
    }
    const status: ImportItemStatus = isNewer(segment.startedAt)
      ? 'newer'
      : overlapsRecorded(segment)
        ? 'recorded'
        : 'new';
    driveDecisions.push({ segment, status });
    if (status === 'new') drives.push(segment);
    else dropped.push([segment.startedAt, segment.endedAt]);
  }

  const charges: PlannedCharge[] = [];
  const chargeDecisions: Plan['chargeDecisions'] = [];
  for (const segment of scan.charges) {
    if (!startsInRange(segment.startedAt)) {
      dropped.push([segment.startedAt, segment.endedAt]);
      continue;
    }
    if (isNewer(segment.startedAt)) {
      chargeDecisions.push({ segment, status: 'newer', sessionId: null });
      dropped.push([segment.startedAt, segment.endedAt]);
      continue;
    }
    const session = closestOverlap(segment, existing.sessions);
    // Still open, or from an earlier import: there's nothing to add.
    if (session && (session.endedAt == null || session.imported)) {
      chargeDecisions.push({ segment, status: 'recorded', sessionId: session.id });
      continue;
    }
    chargeDecisions.push({ segment, status: 'new', sessionId: session?.id ?? null });
    charges.push({ segment, sessionId: session?.id ?? null });
  }

  return {
    from: range.from,
    to: range.to,
    drives,
    drivesRecorded: driveDecisions.filter((d) => d.status === 'recorded').length,
    charges,
    driveDecisions,
    chargeDecisions,
    scope: new RowScope(
      { ...range, lastLiveAt: existing.lastLiveAt },
      existing.heartbeats,
      recordedDrives,
      mergeSpans(drives.map((d) => [d.startedAt, d.endedAt] as const)),
      mergeSpans(charges.map((c) => [c.segment.startedAt, c.segment.endedAt] as const)),
      mergeSpans(dropped),
    ),
  };
}

function closestOverlap(
  charge: ChargeSegment,
  sessions: Existing['sessions'],
): Existing['sessions'][number] | null {
  let best: Existing['sessions'][number] | null = null;
  for (const session of sessions) {
    const end = session.endedAt ?? Infinity;
    if (session.startedAt > charge.endedAt || end < charge.startedAt) continue;
    if (
      !best ||
      Math.abs(session.startedAt - charge.startedAt) < Math.abs(best.startedAt - charge.startedAt)
    ) {
      best = session;
    }
  }
  return best;
}

/**
 * Whether an odometer reading could be this vehicle's: it can't be well below
 * mileage recorded earlier, or well above mileage recorded later.
 */
export function odometerFits(
  history: readonly { at: number; value: number }[],
  reading: { at: number; value: number },
): boolean {
  for (const h of history) {
    if (h.at <= reading.at && reading.value < h.value - ODOMETER_SLACK_M) return false;
    if (h.at >= reading.at && reading.value > h.value + ODOMETER_SLACK_M) return false;
  }
  return true;
}

export async function scanFiles(paths: readonly string[], timeZone: string): Promise<Scan> {
  const scan: Scan = {
    rows: 0,
    unreadable: 0,
    firstAt: null,
    lastAt: null,
    firstMileage: null,
    lastMileage: null,
    drives: [],
    charges: [],
    readingTimes: [],
  };
  const driveFinder = new DriveSegmenter();
  const chargeFinder = new ChargeSegmenter();
  for await (const { row, at } of readRows(paths, timeZone, scan)) {
    scan.rows += 1;
    scan.firstAt = Math.min(scan.firstAt ?? at, at);
    scan.lastAt = Math.max(scan.lastAt ?? at, at);
    if (row.mileageM != null) {
      const reading = { at, value: row.mileageM };
      scan.firstMileage ??= reading;
      scan.lastMileage = reading;
      scan.readingTimes.push(at);
    }
    scan.drives.push(...driveFinder.push(row, at));
    scan.charges.push(...chargeFinder.push(row, at));
  }
  scan.drives.push(...driveFinder.flush());
  scan.charges.push(...chargeFinder.flush());
  return scan;
}

/** The instants a selection's dates start and end (exclusive), in its time zone. */
export function rangeOf(from: string, to: string, timeZone: string): { from: number; to: number } {
  const clock = new TimeZoneClock(timeZone);
  const midnight = (date: string, addDays = 0) => {
    const [year, month, day] = date.split('-').map(Number) as [number, number, number];
    const d = new Date(Date.UTC(year, month - 1, day + addDays));
    return clock.first({
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: 0,
      minute: 0,
      second: 0,
    });
  };
  return { from: midnight(from), to: midnight(to, 1) };
}

const placeName = (lat: number | null, lon: number | null, places: readonly NamedSpot[]) =>
  nearbySpot(lat, lon, places)?.name ?? null;

type NamedSpot = Spot & { name: string };

export function previewOf(
  scan: Scan,
  plan: Plan,
  existing: Existing,
  counted: { readingsNew: number; readingsRecorded: number },
  context: {
    timeZone: string;
    now: number;
    places: readonly NamedSpot[];
    /** What each existing session would gain; absent means nothing. */
    additions: ReadonlyMap<number, readonly ImportSessionAddition[]>;
  },
): ImportPreviewDto {
  const clock = new TimeZoneClock(context.timeZone);
  const fits = (reading: Scan['firstMileage']) =>
    reading == null || odometerFits(existing.mileage, reading);
  const iso = (at: number) => new Date(at).toISOString();
  const charges = plan.chargeDecisions.map(({ segment: c, status, sessionId }) => {
    const adds = sessionId == null ? [] : [...(context.additions.get(sessionId) ?? [])];
    const chargeStatus: ImportChargePreview['status'] =
      status !== 'new'
        ? status
        : sessionId == null
          ? 'new'
          : adds.length > 0
            ? 'enrich'
            : 'recorded';
    return {
      startedAt: iso(c.startedAt),
      endedAt: iso(c.endedAt),
      status: chargeStatus,
      adds,
      chargingSeconds: c.chargingSeconds,
      startSoc: c.startSoc,
      endSoc: c.endSoc,
      energyKwh: c.energyKwh,
      maxPowerKw: c.maxPowerKw,
      place: placeName(c.lat, c.lon, context.places),
    };
  });
  return {
    firstDate: scan.firstAt == null ? null : clock.dateOf(scan.firstAt),
    lastDate: scan.lastAt == null ? null : clock.dateOf(scan.lastAt),
    rows: scan.rows,
    unreadableRows: scan.unreadable,
    drivesNew: plan.drives.length,
    drivesRecorded: plan.drivesRecorded,
    drivesNewer: plan.driveDecisions.filter((d) => d.status === 'newer').length,
    sessionsNew: charges.filter((c) => c.status === 'new').length,
    sessionsEnriched: charges.filter((c) => c.status === 'enrich').length,
    readingsNew: counted.readingsNew,
    readingsRecorded: counted.readingsRecorded,
    warnings: [
      ...(fits(scan.firstMileage) && fits(scan.lastMileage) ? [] : (['odometer'] as const)),
      ...(scan.lastAt != null && scan.lastAt > context.now + FUTURE_SLACK_MS
        ? (['future'] as const)
        : []),
    ],
    drives: plan.driveDecisions.map(({ segment: d, status }) => ({
      startedAt: iso(d.startedAt),
      endedAt: iso(d.endedAt),
      status,
      distanceKm: d.distanceKm,
      startBattery: d.start.battery,
      endBattery: d.end.battery,
      startPlace: placeName(d.start.lat, d.start.lon, context.places),
      endPlace: placeName(d.end.lat, d.end.lon, context.places),
    })),
    charges,
  };
}
