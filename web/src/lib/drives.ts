import type { LocationPointDto } from "@server/api-types.js";

/**
 * Speed (km/h) and altitude (m) by minutes into the drive, for charting.
 * Points without either are left out.
 */
export function driveProfile(
  points: readonly LocationPointDto[],
  startedAt: string,
): { minutes: number; speedKmh: number | null; altitudeM: number | null }[] {
  const start = Date.parse(startedAt);
  return points
    .filter((p) => p.speedKmh != null || p.altitude != null)
    .map((p) => ({
      minutes: Math.max(0, (Date.parse(p.ts) - start) / 60_000),
      speedKmh: p.speedKmh,
      altitudeM: p.altitude,
    }));
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
