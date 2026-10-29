import type { VehicleInsightsDto } from '@server/api-types';
import type { useUnits } from '../api/hooks';
import { fmt } from './state';

export type Navigation = NonNullable<VehicleInsightsDto['navigation']>;

export type Stop = Navigation['stops'][number];

/** When, how long and how far to go, as display text; null where navigation hasn't said. */
function toGo(
  to: { etaAt: string | null; remainingS: number | null; remainingKm: number | null },
  u: ReturnType<typeof useUnits>,
) {
  const minutes = to.remainingS != null ? Math.round(to.remainingS / 60) : null;
  return {
    eta: to.etaAt
      ? new Date(to.etaAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : null,
    timeLeft:
      minutes == null
        ? null
        : minutes >= 60
          ? `${Math.floor(minutes / 60)} h ${minutes % 60} min`
          : `${minutes} min`,
    distanceLeft:
      to.remainingKm != null ? u.formatDistance(to.remainingKm, to.remainingKm < 10 ? 1 : 0) : null,
  };
}

/** A stop's arrival figures as display text. */
export const stopFacts = (stop: Stop, u: ReturnType<typeof useUnits>) => toGo(stop, u);

/** Navigation's arrival figures as display text; null where it hasn't said. */
export function arrivalFacts(n: Navigation, u: ReturnType<typeof useUnits>) {
  return {
    ...toGo(n, u),
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

/** Where navigation is headed next, and how many stops come after it. */
export function nextStop(n: Navigation): { name: string | null; after: number } {
  return { name: n.stops[0]?.name ?? n.destination.name, after: Math.max(0, n.stops.length - 1) };
}

/** "+1 stop" for the stops after the next; null with none. */
export const moreStops = (after: number) =>
  after > 0 ? `+${after} ${after === 1 ? 'stop' : 'stops'}` : null;

/**
 * A route with stops on the way, numbered from the next (1) to the
 * destination, each at how far along the drive it is (0–1); none for a
 * single destination, or without the distances to place them.
 */
export function stopMarks(
  drivenKm: number | null,
  n: Navigation,
): { at: number; name: string | null; number: number }[] {
  if (n.stops.length < 2 || routeProgress(drivenKm, n.remainingKm) == null) return [];
  const total = drivenKm! + n.remainingKm!;
  return n.stops.flatMap((stop, i) => {
    // The destination is the end of the bar, whatever its own figure says.
    const at =
      i === n.stops.length - 1
        ? 1
        : stop.remainingKm != null
          ? (drivenKm! + stop.remainingKm) / total
          : null;
    return at == null ? [] : [{ at, name: stop.name, number: i + 1 }];
  });
}

/**
 * Navigation's route for the map, as [lat, lon]: its line and destination,
 * and with stops on the way, every stop numbered as on the drive's bar.
 */
export function routePlan(n: Navigation) {
  return {
    route: n.route,
    stops:
      n.stops.length > 1
        ? n.stops.map((s) => ({ at: [s.lat, s.lon] as [number, number], name: s.name }))
        : [],
    destination: [n.destination.lat, n.destination.lon] as [number, number],
  };
}
