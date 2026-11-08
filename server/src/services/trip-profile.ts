import type { TripProfilePointDto } from '../api-types.js';
import { haversineKm } from './state-utils.js';

/** About this many points across a whole trip: more than a chart's width can show. */
const MAX_POINTS = 800;
/** Readings each altitude is taken as the median of; GPS altitude jumps about. */
const SMOOTHING = 5;

interface Reading {
  lat: number;
  lon: number;
  altitude: number | null;
  driveId: number | null;
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1]!;

/**
 * Each drive's elevation by distance, from readings in time order. A stretch
 * of road becomes its highest point, so a pass stays at its true height
 * however long the trip.
 */
export function tripProfiles(
  rows: readonly Reading[],
  maxPoints = MAX_POINTS,
): Map<number, TripProfilePointDto[]> {
  const drives = new Map<number, Reading[]>();
  for (const r of rows) {
    if (r.driveId == null || r.altitude == null) continue;
    const readings = drives.get(r.driveId);
    if (readings) readings.push(r);
    else drives.set(r.driveId, [r]);
  }

  const paths = new Map<number, TripProfilePointDto[]>();
  let totalKm = 0;
  for (const [driveId, readings] of drives) {
    let km = 0;
    paths.set(
      driveId,
      readings.map((r, i) => {
        const prev = readings[i - 1];
        if (prev) km += haversineKm(prev.lat, prev.lon, r.lat, r.lon);
        const window = readings.slice(Math.max(0, i - (SMOOTHING >> 1)), i + (SMOOTHING >> 1) + 1);
        return { km, altitudeM: median(window.map((w) => w.altitude!)) };
      }),
    );
    totalKm += km;
  }

  const stepKm = totalKm / maxPoints;
  const profiles = new Map<number, TripProfilePointDto[]>();
  for (const [driveId, path] of paths) {
    const kept: TripProfilePointDto[] = [];
    let bucket = -1;
    for (const point of path) {
      const at = stepKm > 0 ? Math.floor(point.km / stepKm) : 0;
      const last = kept.at(-1);
      if (at !== bucket || !last) {
        kept.push(point);
        bucket = at;
      } else if (point.altitudeM > last.altitudeM) {
        kept[kept.length - 1] = point;
      }
    }
    profiles.set(driveId, kept);
  }
  return profiles;
}
