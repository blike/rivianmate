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
