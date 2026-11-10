import type { LocationPointDto } from '@server/api-types';
import { isPosition } from './geo';

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

/**
 * About how many points a drive's chart draws: more than one a pixel at
 * its widest. A long drive's every position (tens of thousands) would make
 * every hover slower, for detail no one could see.
 */
export const CHART_POINTS = 1000;

/** At most about `max` of `items`, every nth evenly, always keeping the last. */
export function evenly<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return [...items];
  const step = Math.ceil(items.length / max);
  const kept = items.filter((_, i) => i % step === 0);
  if ((items.length - 1) % step !== 0) kept.push(items.at(-1)!);
  return kept;
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

/** Average speed leaving out stops (km/h); null when it can't be worked out. */
export function movingSpeedKmh(
  distanceKm: number | null,
  movingSeconds: number | null,
): number | null {
  if (distanceKm == null || movingSeconds == null || !(movingSeconds > 0)) return null;
  return distanceKm / (movingSeconds / 3600);
}

/** Range the vehicle's estimate dropped by; negative if it rose, null if unknown. */
export function rangeUsedKm(startKm: number | null, endKm: number | null): number | null {
  if (startKm == null || endKm == null) return null;
  return startKm - endKm;
}

export interface Day<T> {
  /** Local date, YYYY-MM-DD. */
  key: string;
  /** "Today", "Yesterday", or e.g. "Wed, Oct 7". */
  label: string;
  items: T[];
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A time's local date as YYYY-MM-DD, as days are keyed. */
export function localKey(when: string | number | Date): string {
  const d = new Date(when);
  return `${String(d.getFullYear()).padStart(4, '0')}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

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
          ? 'Today'
          : key === yesterday
            ? 'Yesterday'
            : start.toLocaleDateString([], {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                ...(start.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
              });
      day = { key, label, items: [] };
      days.push(day);
    }
    day.items.push(item);
  }
  return days;
}

export interface DriveDay<T> extends Omit<Day<T>, 'items'> {
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
