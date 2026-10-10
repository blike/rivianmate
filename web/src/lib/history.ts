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

export type ActivityKind = "drive" | "charging" | "plugged";

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
  chargeSpans: readonly { kind: "charging" | "plugged"; from: string; to: string }[],
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
  for (const d of drives) add("drive", d.startedAt, d.endedAt);
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
  unit: "day" | "hour",
): { ts: number; km: number }[] {
  const start = new Date(from);
  if (unit === "day") start.setHours(0, 0, 0, 0);
  else start.setMinutes(0, 0, 0);
  const step = (d: Date) => (unit === "day" ? d.setDate(d.getDate() + 1) : d.setHours(d.getHours() + 1));

  const buckets: { ts: number; km: number }[] = [];
  for (const d = new Date(start); d.getTime() <= to; step(d)) buckets.push({ ts: d.getTime(), km: 0 });

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
export function positionAt(points: readonly { ts: number; lat: number; lon: number }[], ts: number): [number, number] | null {
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
