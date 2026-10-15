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
