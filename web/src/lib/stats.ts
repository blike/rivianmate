import type { StatDriveDto } from "@server/api-types.js";
import { titleCase } from "./state.js";

/**
 * Shorter drives are left out of efficiency figures: a 1% battery step is
 * a large share of the energy they use, so their figures are mostly noise.
 */
export const MIN_EFFICIENCY_KM = 5;

/** Drives the efficiency figures are based on. */
export function efficiencyDrives(drives: readonly StatDriveDto[]): (StatDriveDto & { distanceKm: number; energyKwh: number })[] {
  return drives.filter(
    (d): d is StatDriveDto & { distanceKm: number; energyKwh: number } =>
      d.distanceKm != null && d.distanceKm >= MIN_EFFICIENCY_KM && d.energyKwh != null && d.energyKwh > 0,
  );
}

export interface EnergyDistance {
  distanceKm: number;
  energyKwh: number;
}

/**
 * Each drive with the distance-weighted totals of it and the drives before
 * it, up to `window` drives, for a rolling average that long drives weigh
 * more in.
 */
export function rollingEfficiency<T extends EnergyDistance>(
  drives: readonly T[],
  window = 10,
): { drive: T; rolling: EnergyDistance }[] {
  return drives.map((drive, i) => {
    let distanceKm = 0;
    let energyKwh = 0;
    for (let j = Math.max(0, i - window + 1); j <= i; j++) {
      distanceKm += drives[j]!.distanceKm;
      energyKwh += drives[j]!.energyKwh;
    }
    return { drive, rolling: { distanceKm, energyKwh } };
  });
}

/** Drives grouped by `key`, with their summed distance and energy; null keys are left out. */
export function groupEfficiency<T extends EnergyDistance>(
  drives: readonly T[],
  key: (d: T) => string | null,
): Map<string, EnergyDistance & { drives: number }> {
  const groups = new Map<string, EnergyDistance & { drives: number }>();
  for (const d of drives) {
    const k = key(d);
    if (k == null) continue;
    const g = groups.get(k) ?? { drives: 0, distanceKm: 0, energyKwh: 0 };
    g.drives += 1;
    g.distanceKm += d.distanceKm;
    g.energyKwh += d.energyKwh;
    groups.set(k, g);
  }
  return groups;
}

/** Linear-interpolated percentile (`p` in 0–1); null for no values. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export interface SpeedBand {
  label: string;
  /** Lower bound, inclusive, in km/h. */
  minKmh: number;
}

const MPH_TO_KMH = 1.609344;

/** Average-speed bands, in round numbers of the display unit. */
export function speedBands(miles: boolean): SpeedBand[] {
  const edges = miles ? [0, 25, 40, 55, 70] : [0, 40, 60, 80, 100, 120];
  const unit = miles ? "mph" : "km/h";
  return edges.map((edge, i) => {
    const next = edges[i + 1];
    return {
      label: i === 0 ? `Under ${next} ${unit}` : next == null ? `${edge}+ ${unit}` : `${edge}–${next} ${unit}`,
      minKmh: miles ? edge * MPH_TO_KMH : edge,
    };
  });
}

/** The band an average speed falls in. */
export function speedBandFor(bands: readonly SpeedBand[], kmh: number): SpeedBand {
  let band = bands[0]!;
  for (const b of bands) if (kmh >= b.minKmh) band = b;
  return band;
}

/** Average speed over a drive, stops included (km/h); null for no time. */
export function driveAverageKmh(d: Pick<StatDriveDto, "distanceKm" | "durationS">): number | null {
  if (d.distanceKm == null || !(d.durationS > 0)) return null;
  return d.distanceKm / (d.durationS / 3600);
}

const DRIVE_MODES: Record<string, string> = {
  everyday: "All-Purpose",
  distance: "Conserve",
  sport: "Sport",
  winter: "Snow",
  towing: "Towing",
};

/** Rivian's drive mode names as the vehicle shows them. */
export function driveModeLabel(mode: string | null): string {
  if (!mode) return "Unknown";
  const known = DRIVE_MODES[mode.toLowerCase()];
  if (known) return known;
  const offRoad = /^off_?road_?(.*)$/i.exec(mode);
  if (offRoad) return offRoad[1] ? `Off-Road ${titleCase(offRoad[1])}` : "Off-Road";
  return titleCase(mode);
}

export type Granularity = "day" | "week" | "month";

/** Bars per day up to three months, per week up to a year, else per month. */
export function granularityFor(spanDays: number): Granularity {
  return spanDays <= 92 ? "day" : spanDays <= 366 ? "week" : "month";
}

/** Local midnight of a "YYYY-MM-DD" day. */
export function localDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

/** Start of the bucket a local day falls in; weeks start on Monday. */
export function bucketStart(date: Date, granularity: Granularity): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (granularity === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  if (granularity === "month") d.setDate(1);
  return d;
}

function nextBucket(d: Date, granularity: Granularity): Date {
  const next = new Date(d);
  if (granularity === "day") next.setDate(next.getDate() + 1);
  else if (granularity === "week") next.setDate(next.getDate() + 7);
  else next.setMonth(next.getMonth() + 1);
  return next;
}

// A type, not an interface, so rows fit chart data's index signature.
export type ChargeBucket = {
  /** Local start of the bucket, in ms. */
  start: number;
  acKwh: number;
  dcKwh: number;
  unknownKwh: number;
};

/**
 * Daily AC/DC energy summed into buckets from `from` (or the first day)
 * through `to`, with empty buckets kept so bars sit evenly in time.
 */
export function chargeBuckets(
  days: readonly { day: string; acKwh: number; dcKwh: number; unknownKwh: number }[],
  granularity: Granularity,
  to: Date,
  from?: Date,
): ChargeBucket[] {
  const first = from ?? (days[0] ? localDay(days[0].day) : null);
  if (!first) return [];
  const buckets = new Map<number, ChargeBucket>();
  for (let d = bucketStart(first, granularity); d <= to; d = nextBucket(d, granularity)) {
    buckets.set(d.getTime(), { start: d.getTime(), acKwh: 0, dcKwh: 0, unknownKwh: 0 });
  }
  for (const day of days) {
    const bucket = buckets.get(bucketStart(localDay(day.day), granularity).getTime());
    if (!bucket) continue;
    bucket.acKwh += day.acKwh;
    bucket.dcKwh += day.dcKwh;
    bucket.unknownKwh += day.unknownKwh;
  }
  return [...buckets.values()];
}
