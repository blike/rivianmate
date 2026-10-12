import { haversineKm } from './state-utils.js';

/** A place the user named, matched within radiusM of its point. */
export interface SavedLocation {
  id: number;
  name: string;
  lat: number;
  lon: number;
  radiusM: number;
  /** Counts as home for "only when not at home" alerts and home charging. */
  isHome: boolean;
  /** Price per kWh here; null = no estimate, 0 = free. */
  ratePerKwh: number | null;
}

export interface ChargingSettings {
  /** Currency of every location's rate, and of estimates made from them. */
  currency: string;
}

export const DEFAULT_CHARGING: ChargingSettings = { currency: 'USD' };

/** A location's area, and how near a wallbox counts as at it. */
export const DEFAULT_RADIUS_M = 150;
export const MIN_RADIUS_M = 25;
export const MAX_RADIUS_M = 1000;

export interface SessionPlaceFacts {
  isPublic: boolean | null;
  isHomeCharger: boolean | null;
  chargerType: string | null;
  lat: number | null;
  lon: number | null;
}

export interface Spot {
  lat: number;
  lon: number;
  /** Defaults to DEFAULT_RADIUS_M. */
  radiusM?: number;
}

/**
 * The spot whose area holds the point, if any. Where areas overlap, the one
 * the point is deepest inside (relative to its size) wins, so a small "Work
 * garage" inside a large "Campus" takes the garage's name.
 */
export function nearbySpot<T extends Spot>(
  lat: number | null,
  lon: number | null,
  spots: readonly T[],
): T | null {
  if (lat == null || lon == null) return null;
  let best: T | null = null;
  let bestDepth = 1;
  for (const spot of spots) {
    const radiusKm = (spot.radiusM ?? DEFAULT_RADIUS_M) / 1000;
    const depth = haversineKm(lat, lon, spot.lat, spot.lon) / radiusKm;
    if (depth <= bestDepth) {
      best = spot;
      bestDepth = depth;
    }
  }
  return best;
}

/**
 * Where a session happened: the saved location around it, and whether it was
 * home charging. Home if Rivian says so, the charger is a home wallbox, or
 * it's at a home location or near a registered wallbox; anything Rivian
 * marks as public never counts as home.
 */
export function sessionPlace(
  session: SessionPlaceFacts,
  locations: readonly SavedLocation[],
  wallboxSpots: readonly Spot[],
): { location: SavedLocation | null; isHome: boolean } {
  const location = nearbySpot(session.lat, session.lon, locations);
  const isHome =
    session.isPublic !== true &&
    (session.isHomeCharger === true ||
      session.chargerType === 'wallbox' ||
      location?.isHome === true ||
      nearbySpot(session.lat, session.lon, wallboxSpots) !== null);
  return { location, isHome };
}

/**
 * The rate a session is priced at: its location's, or for home charging
 * outside every location (a Wall Charger session with no position, say) the
 * home location's, as when there was a single home rate.
 */
export function sessionRate(
  place: { location: SavedLocation | null; isHome: boolean },
  locations: readonly SavedLocation[],
): number | null {
  if (place.location) return place.location.ratePerKwh;
  if (!place.isHome) return null;
  return locations.find((l) => l.isHome)?.ratePerKwh ?? null;
}

/** Energy × rate, rounded to cents; null when either is unknown. */
export function estimateCost(energyKwh: number | null, ratePerKwh: number | null): string | null {
  if (energyKwh == null || ratePerKwh == null || !(energyKwh > 0)) return null;
  return (Math.round(energyKwh * ratePerKwh * 100) / 100).toFixed(2);
}

/** Registered wallboxes with a known position. */
export function wallboxSpots(
  wallboxes: readonly { latitude: number | null; longitude: number | null }[],
): Spot[] {
  return wallboxes
    .filter((w) => w.latitude != null && w.longitude != null)
    .map((w) => ({ lat: w.latitude!, lon: w.longitude! }));
}

/** Wallboxes and home locations: where the vehicle counts as at home. */
export function homeSpots(
  locations: readonly SavedLocation[],
  wallboxes: readonly { latitude: number | null; longitude: number | null }[],
): Spot[] {
  return [...wallboxSpots(wallboxes), ...locations.filter((l) => l.isHome)];
}
