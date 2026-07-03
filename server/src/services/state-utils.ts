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

export function stateLocation(state: VehicleState): GnssLocation | null {
  const loc = state.gnssLocation;
  if (!loc || typeof loc.latitude !== "number") return null;
  return loc;
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
