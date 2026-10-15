import type { VehicleInsightsDto } from '@server/api-types';
import type { useUnits } from '../api/hooks';
import { fmt } from './state';

export type Navigation = NonNullable<VehicleInsightsDto['navigation']>;

/** Navigation's arrival figures as display text; null where it hasn't said. */
export function arrivalFacts(n: Navigation, u: ReturnType<typeof useUnits>) {
  const minutes = n.remainingS != null ? Math.round(n.remainingS / 60) : null;
  return {
    eta: n.etaAt
      ? new Date(n.etaAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : null,
    timeLeft:
      minutes == null
        ? null
        : minutes >= 60
          ? `${Math.floor(minutes / 60)} h ${minutes % 60} min`
          : `${minutes} min`,
    distanceLeft:
      n.remainingKm != null ? u.formatDistance(n.remainingKm, n.remainingKm < 10 ? 1 : 0) : null,
    battery: n.arrivalSoc != null ? `${fmt(n.arrivalSoc, 0)}%` : null,
    range: n.arrivalRangeKm != null ? u.formatDistance(n.arrivalRangeKm) : null,
  };
}

/**
 * How far along the route a drive under way is, 0–1: the distance driven
 * against that plus what navigation has left. Rivian recalculates the route
 * from where the vehicle is, so the route's own total can't be used.
 */
export function routeProgress(drivenKm: number | null, remainingKm: number | null): number | null {
  if (drivenKm == null || remainingKm == null || drivenKm < 0 || remainingKm < 0) return null;
  const total = drivenKm + remainingKm;
  return total > 0 ? drivenKm / total : null;
}
