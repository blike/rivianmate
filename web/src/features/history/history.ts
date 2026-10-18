/** Pure calculations for the History page. */

export interface PeriodDrive {
  startedAt: string;
  endedAt: string | null;
  distanceKm: number | null;
  energyKwh: number | null;
}

export interface PeriodSession {
  startedAt: string;
  endedAt: string | null;
  energyKwh: number | null;
  cost?: string | null;
  /** Energy × home rate, for a home session with no cost of its own. */
  estimatedCost?: string | null;
  currency?: string | null;
}

export interface PeriodSummary {
  distanceKm: number;
  drives: number;
  drivingSeconds: number;
  /** Energy used on drives with a known figure, and the distance those covered. */
  energyKwh: number;
  energyDistanceKm: number;
  chargedKwh: number;
  sessions: number;
  /** Charging cost, recorded or estimated; null when no session has either. */
  cost: number | null;
  /** True when some of `cost` is an estimate from the home rate. */
  costEstimated: boolean;
  currency: string | null;
}

/**
 * The window a range covers, ending now. Ranges of days start at local
 * midnight, so "7 days" is today and the six before it rather than 168
 * hours reaching partway into an eighth day; 24 hours stays rolling.
 */
export function rangeWindow(hours: number, now: Date): { from: Date; to: Date } {
  if (hours <= 24) return { from: new Date(now.getTime() - hours * 3600_000), to: now };
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - (Math.round(hours / 24) - 1));
  return { from, to: now };
}

const inWindow = (iso: string, from: number, to: number) => {
  const t = Date.parse(iso);
  return t >= from && t <= to;
};

/** Totals for drives and charging sessions that started within [from, to]. */
export function periodSummary(
  drives: readonly PeriodDrive[],
  sessions: readonly PeriodSession[],
  from: number,
  to: number,
  now = to,
): PeriodSummary {
  const summary: PeriodSummary = {
    distanceKm: 0,
    drives: 0,
    drivingSeconds: 0,
    energyKwh: 0,
    energyDistanceKm: 0,
    chargedKwh: 0,
    sessions: 0,
    cost: null,
    costEstimated: false,
    currency: null,
  };
  for (const d of drives) {
    if (!inWindow(d.startedAt, from, to)) continue;
    summary.drives += 1;
    summary.distanceKm += d.distanceKm ?? 0;
    const end = d.endedAt ? Date.parse(d.endedAt) : now;
    summary.drivingSeconds += Math.max(0, end - Date.parse(d.startedAt)) / 1000;
    if (d.energyKwh != null && d.energyKwh > 0 && d.distanceKm != null && d.distanceKm > 0) {
      summary.energyKwh += d.energyKwh;
      summary.energyDistanceKm += d.distanceKm;
    }
  }
  for (const s of sessions) {
    if (!inWindow(s.startedAt, from, to)) continue;
    summary.sessions += 1;
    summary.chargedKwh += s.energyKwh ?? 0;
    const amount = Number(s.cost ?? s.estimatedCost);
    if ((s.cost ?? s.estimatedCost) != null && Number.isFinite(amount)) {
      summary.cost = (summary.cost ?? 0) + amount;
      if (s.cost == null) summary.costEstimated = true;
      summary.currency ??= s.currency ?? null;
    }
  }
  return summary;
}

export type ActivityKind = 'drive' | 'charging' | 'plugged';

export interface ActivityBand {
  kind: ActivityKind;
  from: number;
  to: number;
}

/**
 * Drives and plugged-in time as spans clipped to [from, to], for shading a
 * chart. A drive still in progress runs to `now`.
 */
export function activityBands(
  drives: readonly PeriodDrive[],
  chargeSpans: readonly { kind: 'charging' | 'plugged'; from: string; to: string }[],
  from: number,
  to: number,
  now = to,
): ActivityBand[] {
  const bands: ActivityBand[] = [];
  const add = (kind: ActivityKind, startIso: string, endIso: string | null) => {
    const start = Date.parse(startIso);
    const end = endIso ? Date.parse(endIso) : now;
    if (!Number.isFinite(start) || end < from || start > to) return;
    bands.push({ kind, from: Math.max(start, from), to: Math.min(Math.max(end, start), to) });
  };
  for (const s of chargeSpans) add(s.kind, s.from, s.to);
  for (const d of drives) add('drive', d.startedAt, d.endedAt);
  return bands.sort((a, b) => a.from - b.from);
}

/**
 * Distance driven per local day (or hour), every bucket in the window
 * included so quiet days show as gaps. A drive counts toward the bucket it
 * started in.
 */
export function distanceByPeriod(
  drives: readonly PeriodDrive[],
  from: number,
  to: number,
  unit: 'day' | 'hour',
): { ts: number; km: number }[] {
  const start = new Date(from);
  if (unit === 'day') start.setHours(0, 0, 0, 0);
  else start.setMinutes(0, 0, 0);
  const step = (d: Date) =>
    unit === 'day' ? d.setDate(d.getDate() + 1) : d.setHours(d.getHours() + 1);

  const buckets: { ts: number; km: number }[] = [];
  for (const d = new Date(start); d.getTime() <= to; step(d))
    buckets.push({ ts: d.getTime(), km: 0 });

  for (const drive of drives) {
    const t = Date.parse(drive.startedAt);
    if (!(t >= from && t <= to) || !drive.distanceKm) continue;
    // Last bucket starting at or before the drive.
    let i = buckets.length - 1;
    while (i > 0 && buckets[i]!.ts > t) i--;
    buckets[i]!.km += drive.distanceKm;
  }
  return buckets;
}

/**
 * Where the vehicle was at `ts`: the last fix at or before it, since a
 * parked vehicle stays put between fixes. Points must be in time order.
 */
export function positionAt(
  points: readonly { ts: number; lat: number; lon: number }[],
  ts: number,
): [number, number] | null {
  let lo = 0;
  let hi = points.length - 1;
  if (hi < 0 || points[0]!.ts > ts) return null;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (points[mid]!.ts <= ts) lo = mid;
    else hi = mid - 1;
  }
  return [points[lo]!.lat, points[lo]!.lon];
}

export type VehicleActivity = 'driving' | 'charging' | 'updating' | 'awake' | 'asleep';

export interface StateSegment {
  state: VehicleActivity;
  from: number;
  to: number;
}

export interface StateRow {
  /** Where the row's track starts and ends; segments are placed within it. */
  from: number;
  to: number;
  segments: StateSegment[];
}

/**
 * State spans laid out in rows: one per local day from the day `from` falls
 * in (each a full day, so today's ends blank after now), or a single row
 * over [from, to]. Segments are clipped to their row.
 */
export function stateRows(
  spans: readonly { state: VehicleActivity; from: string; to: string }[],
  from: number,
  to: number,
  byDay: boolean,
): StateRow[] {
  const rows: StateRow[] = [];
  if (byDay) {
    const day = new Date(from);
    day.setHours(0, 0, 0, 0);
    while (day.getTime() <= to) {
      const start = day.getTime();
      // setDate steps by calendar day, so DST days are 23 or 25 hours.
      day.setDate(day.getDate() + 1);
      rows.push({ from: start, to: day.getTime(), segments: [] });
    }
  } else {
    rows.push({ from, to, segments: [] });
  }
  for (const s of spans) {
    const start = Date.parse(s.from);
    const end = Date.parse(s.to);
    for (const row of rows) {
      if (end <= row.from || start >= row.to) continue;
      row.segments.push({
        state: s.state,
        from: Math.max(start, row.from),
        to: Math.min(end, row.to),
      });
    }
  }
  return rows;
}

/** Milliseconds spent in each state. */
export function stateTotals(
  spans: readonly { state: VehicleActivity; from: string; to: string }[],
): Map<VehicleActivity, number> {
  const totals = new Map<VehicleActivity, number>();
  for (const s of spans) {
    const ms = Date.parse(s.to) - Date.parse(s.from);
    if (ms > 0) totals.set(s.state, (totals.get(s.state) ?? 0) + ms);
  }
  return totals;
}

/**
 * Location points grouped into one [lat, lon] line per drive, in time order.
 * Points recorded while parked (no drive) aren't part of any line.
 */
export function tripLines(
  points: readonly { lat: number; lon: number; driveId?: number | null }[],
): [number, number][][] {
  const trips: [number, number][][] = [];
  let current: number | null = null;
  for (const p of points) {
    if (p.driveId == null) {
      current = null;
      continue;
    }
    if (p.driveId !== current) {
      trips.push([]);
      current = p.driveId;
    }
    trips.at(-1)!.push([p.lat, p.lon]);
  }
  return trips;
}
