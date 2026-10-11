import { useDrive, useDrives } from '../../api/hooks';
import { isPosition } from '../../lib/geo';

/**
 * The route so far of a drive under way, ending at the vehicle. The map
 * keeps following the vehicle; the trail is only drawn behind it.
 */
export function useActiveDriveTrail(
  vehicleId: string,
  loc: { lat: number; lon: number } | null,
): [number, number][] | undefined {
  // Shares the drive list and drive detail caches with the other pages.
  const { data: drives } = useDrives(vehicleId);
  const active = drives?.[0] && !drives[0].endedAt ? drives[0].id : null;
  const { data: detail } = useDrive(vehicleId, active);
  if (active == null || detail?.id !== active) return undefined;
  const points = detail.points
    .filter((p) => isPosition(p.lat, p.lon))
    .map((p) => [p.lat, p.lon] as [number, number]);
  return loc ? [...points, [loc.lat, loc.lon]] : points;
}
