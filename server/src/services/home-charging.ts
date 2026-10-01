import { haversineKm } from "./state-utils.js";

export interface HomeChargingSettings {
  /** Price per kWh for charging at home; null = not set. */
  ratePerKwh: number | null;
  currency: string;
  /** Optional home location, for home chargers Rivian doesn't know about. */
  homeLat: number | null;
  homeLon: number | null;
}

export const DEFAULT_HOME_CHARGING: HomeChargingSettings = {
  ratePerKwh: null,
  currency: "USD",
  homeLat: null,
  homeLon: null,
};

/** Within this distance of a home charger or home location counts as home. */
export const HOME_RADIUS_KM = 0.15;

export interface SessionHomeFacts {
  isPublic: boolean | null;
  isHomeCharger: boolean | null;
  chargerType: string | null;
  lat: number | null;
  lon: number | null;
}

export interface Spot {
  lat: number;
  lon: number;
}

/** Nearest spot within the home radius, if any. */
export function nearbySpot<T extends Spot>(
  lat: number | null,
  lon: number | null,
  spots: readonly T[],
): T | null {
  if (lat == null || lon == null) return null;
  let best: T | null = null;
  let bestKm = HOME_RADIUS_KM;
  for (const spot of spots) {
    const km = haversineKm(lat, lon, spot.lat, spot.lon);
    if (km <= bestKm) {
      best = spot;
      bestKm = km;
    }
  }
  return best;
}

/**
 * Home if Rivian says so, the charger is a home wallbox, or the session
 * happened near a registered wallbox or the configured home location.
 * Anything Rivian marks as public never counts.
 */
export function isHomeSession(
  session: SessionHomeFacts,
  homeSpots: readonly Spot[],
): boolean {
  if (session.isPublic === true) return false;
  if (session.isHomeCharger === true || session.chargerType === "wallbox") return true;
  return nearbySpot(session.lat, session.lon, homeSpots) !== null;
}

/** Energy × home rate, rounded to cents; null when either is unknown. */
export function estimateHomeCost(
  energyKwh: number | null,
  ratePerKwh: number | null,
): string | null {
  if (energyKwh == null || ratePerKwh == null || !(energyKwh > 0)) return null;
  return (Math.round(energyKwh * ratePerKwh * 100) / 100).toFixed(2);
}

/** Wallboxes and the home location as spots. */
export function homeSpots(
  settings: HomeChargingSettings,
  wallboxes: readonly { latitude: number | null; longitude: number | null }[],
): Spot[] {
  const spots: Spot[] = wallboxes
    .filter((w) => w.latitude != null && w.longitude != null)
    .map((w) => ({ lat: w.latitude!, lon: w.longitude! }));
  if (settings.homeLat != null && settings.homeLon != null) {
    spots.push({ lat: settings.homeLat, lon: settings.homeLon });
  }
  return spots;
}
