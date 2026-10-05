import type {
  GnssLocation,
  TimeStampedValue,
  VehicleState,
} from "../rivian/types.js";

const INVALID_SENSOR_STATES = new Set([
  "fault",
  "signal_not_available",
  "undefined",
]);

/**
 * Merge a subscription delta into the cached full state, dropping invalid
 * sensor values in favor of the previously known value (HA behavior).
 * Returns the list of property names that actually changed.
 */
export function mergeVehicleState(
  cached: VehicleState,
  delta: VehicleState,
  timestampOrderedFields: readonly string[] = [],
): string[] {
  const changed: string[] = [];
  for (const [key, incoming] of Object.entries(delta)) {
    if (incoming == null) continue;
    const record = incoming as TimeStampedValue;
    if (
      typeof record.value === "string" &&
      INVALID_SENSOR_STATES.has(record.value)
    ) {
      continue;
    }
    const prev = cached[key];
    // GPS and tires can arrive from either stream. Keep the newest reading,
    // while allowing legacy updates before Parallax reports or after it stops.
    if (timestampOrderedFields.includes(key) && prev) {
      const previousAt = Date.parse((prev as TimeStampedValue).timeStamp);
      const incomingAt = Date.parse(record.timeStamp);
      if (Number.isFinite(previousAt) && Number.isFinite(incomingAt) && incomingAt < previousAt) continue;
    }
    cached[key] = incoming;
    if (JSON.stringify(prev) !== JSON.stringify(incoming)) changed.push(key);
  }
  return changed;
}

export function stateValue(
  state: VehicleState,
  key: string,
): string | number | null {
  const record = state[key] as TimeStampedValue | undefined;
  if (!record || !("value" in record)) return null;
  return record.value;
}

export function stateNumber(state: VehicleState, key: string): number | null {
  const value = stateValue(state, key);
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function stateString(state: VehicleState, key: string): string | null {
  const value = stateValue(state, key);
  return value == null ? null : String(value);
}

/** The vehicle's GPS fix, or null when there's none (Rivian sends 0,0 without one). */
export function stateLocation(state: VehicleState): GnssLocation | null {
  const loc = state.gnssLocation;
  if (!loc || !isPosition(loc.latitude, loc.longitude)) return null;
  return loc;
}

/** A real position: finite, in range, and not 0,0. */
export function isPosition(lat: unknown, lon: unknown): lat is number {
  if (typeof lat !== "number" || typeof lon !== "number") return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;
  return Math.abs(lat) > 1e-4 || Math.abs(lon) > 1e-4;
}

export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
