import { useDrive, useDrives } from '../../api/hooks';
import { useLiveTrail } from '../../lib/liveTrail';

/**
 * The route so far of a drive under way, ending at the vehicle. The map
 * keeps following the vehicle; the trail is only drawn behind it.
 */
export function useActiveDriveTrail(vehicleId: string): [number, number][] | undefined {
  // Shares the drive list and drive detail caches with the other pages.
  const { data: drives } = useDrives(vehicleId);
  const active = drives?.[0] && !drives[0].endedAt ? drives[0].id : null;
  const { data: detail } = useDrive(vehicleId, active);
  const loaded = active != null && detail?.id === active;
  const trail = useLiveTrail(vehicleId, loaded ? detail : null, loaded ? detail.points : []);
  return loaded ? trail : undefined;
}
