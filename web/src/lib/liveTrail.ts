import type { LocationPointDto } from '@server/api-types';
import { type LiveFix, useLiveFixes } from '../api/hooks';
import { isPosition } from './geo';

/**
 * A drive's route so far, ending at the vehicle: its stored points, then
 * every fix the live stream has sent since. The server stores each fix too,
 * but the drive is only refetched every few seconds; drawing just the latest
 * fix would cut straight across to the vehicle until then.
 */
export function useLiveTrail(
  vehicleId: string,
  drive: { startedAt: string } | null,
  points: LocationPointDto[],
): [number, number][] {
  const fixes = useLiveFixes(vehicleId);
  if (!drive) return liveTrail(points, []);
  const since = Date.parse(drive.startedAt);
  return liveTrail(
    points,
    fixes.filter((f) => Date.parse(f.ts) >= since),
  );
}

/** The stored points, then the live fixes newer than them. */
export function liveTrail(points: LocationPointDto[], fixes: LiveFix[]): [number, number][] {
  const last = points.length > 0 ? Date.parse(points.at(-1)!.ts) : -Infinity;
  return [...points, ...fixes.filter((f) => Date.parse(f.ts) > last)]
    .filter((p) => isPosition(p.lat, p.lon))
    .map((p) => [p.lat, p.lon]);
}
