import type { LocationPointDto } from "@server/api-types.js";
import { isPosition } from "./geo.js";

/**
 * Speed (km/h) and altitude (m) by minutes into the drive, for charting.
 * Points without either are left out.
 */
export function driveProfile(
  points: readonly LocationPointDto[],
  startedAt: string,
): ProfilePoint[] {
  const start = Date.parse(startedAt);
  return points
    .filter((p) => p.speedKmh != null || p.altitude != null)
    .map((p) => {
      const valid = isPosition(p.lat, p.lon);
      return {
        minutes: Math.max(0, (Date.parse(p.ts) - start) / 60_000),
        speedKmh: p.speedKmh,
        altitudeM: p.altitude,
        lat: valid ? p.lat : null,
        lon: valid ? p.lon : null,
      };
    });
}

export interface ProfilePoint {
  minutes: number;
  speedKmh: number | null;
  altitudeM: number | null;
  /** Where the reading was taken; null without a usable fix. */
  lat: number | null;
  lon: number | null;
}

/** [lat, lon] of the profile point at `index`, or of the nearest one with a fix. */
export function profilePosition(
  profile: readonly { lat: number | null; lon: number | null }[],
  index: number,
): [number, number] | null {
  for (let d = 0; d < profile.length; d++) {
    for (const i of d === 0 ? [index] : [index - d, index + d]) {
      const p = profile[i];
      if (p?.lat != null && p.lon != null) return [p.lat, p.lon];
    }
  }
  return null;
}

/** Average speed over the whole drive, stops included (km/h). */
export function averageSpeedKmh(
  distanceKm: number | null,
  startedAt: string,
  endedAt: string | null,
  now = Date.now(),
): number | null {
  const hours = ((endedAt ? Date.parse(endedAt) : now) - Date.parse(startedAt)) / 3_600_000;
  if (distanceKm == null || !(hours > 0)) return null;
  return distanceKm / hours;
}

/** Range the vehicle's estimate dropped by; null if it rose or is unknown. */
export function rangeUsedKm(startKm: number | null, endKm: number | null): number | null {
  if (startKm == null || endKm == null || endKm > startKm) return null;
  return startKm - endKm;
}

export interface Day<T> {
  /** Local date, YYYY-MM-DD. */
  key: string;
  /** "Today", "Yesterday", or e.g. "Wed, Oct 7". */
  label: string;
  items: T[];
}

const localKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Items grouped by the local day they started (or `at` gives), keeping their order. */
export function groupByDay<T extends { startedAt: string }>(
  items: readonly T[],
  now = new Date(),
  at: (item: T) => string = (item) => item.startedAt,
): Day<T>[] {
  const today = localKey(now);
  const yesterday = localKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const days: Day<T>[] = [];
  for (const item of items) {
    const start = new Date(at(item));
    const key = localKey(start);
    let day = days.at(-1);
    if (day?.key !== key) {
      const label =
        key === today
          ? "Today"
          : key === yesterday
            ? "Yesterday"
            : start.toLocaleDateString([], {
                weekday: "short",
                month: "short",
                day: "numeric",
                ...(start.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
              });
      day = { key, label, items: [] };
      days.push(day);
    }
    day.items.push(item);
  }
  return days;
}

export interface DriveDay<T> extends Omit<Day<T>, "items"> {
  drives: T[];
  distanceKm: number;
}

/** Drives grouped by the local day they started, with each day's distance. */
export function drivesByDay<T extends { startedAt: string; distanceKm: number | null }>(
  drives: readonly T[],
  now = new Date(),
): DriveDay<T>[] {
  return groupByDay(drives, now).map(({ items, ...day }) => ({
    ...day,
    drives: items,
    distanceKm: items.reduce((sum, d) => sum + (d.distanceKm ?? 0), 0),
  }));
}

const MINUTE_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 240];

/** Whole-minute axis ticks across [min, max] minutes, at most `maxTicks`. */
export function minuteTicks(min: number, max: number, maxTicks = 6): number[] {
  if (!(max > min)) return [];
  const step = MINUTE_STEPS.find((s) => (max - min) / s <= maxTicks - 1) ?? MINUTE_STEPS.at(-1)!;
  const ticks: number[] = [];
  for (let t = Math.ceil(min / step) * step; t <= max; t += step) ticks.push(t);
  return ticks;
}
