import { isPosition } from '../geo.js';
import type { GnssLocation, TimeStampedValue, VehicleState } from '../rivian/types.js';

/**
 * A GNSS fix this close in time to a navigation fix is left out of the track,
 * and off the dashboard's map: the two streams run about a second apart, so
 * using both would put two clocks' worth of readings in one line. Three
 * navigation intervals (every 5 s), so GNSS fills in only once navigation has
 * actually stopped. Not the same question as the decoder's `FIX_WITHIN_MS` (a
 * frame's time against its own fix) or the location writer's `SAME_FIX_MS` (a
 * reading against a fix it belongs to).
 */
export const NAV_COVERS_MS = 15_000;

const INVALID_SENSOR_STATES = new Set(['fault', 'signal_not_available', 'undefined']);
/** Fields where "undefined" is a real reading: preconditioning off. */
const UNDEFINED_IS_A_VALUE = new Set(['cabinPreconditioningStatus']);

/**
 * Readings as the app keeps them, from either feed: numbers without float32
 * noise (53.600002 is 53.6), and bearing as a 0–360 compass heading (legacy
 * sends −180 to 180, Parallax 0–360).
 */
export function normalizeReadings(delta: VehicleState): VehicleState {
  const out: VehicleState = {};
  for (const [key, reading] of Object.entries(delta)) {
    const record = reading as TimeStampedValue | undefined;
    if (record == null || typeof record.value !== 'number' || !('timeStamp' in record)) {
      out[key] = reading;
      continue;
    }
    let value = Math.round(record.value * 1000) / 1000;
    if (key === 'gnssBearing') value = ((value % 360) + 360) % 360;
    out[key] = { ...record, value };
  }
  return out;
}

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
      typeof record.value === 'string' &&
      INVALID_SENSOR_STATES.has(record.value) &&
      !(record.value === 'undefined' && UNDEFINED_IS_A_VALUE.has(key))
    ) {
      continue;
    }
    const prev = cached[key];
    // GPS and tires can arrive from either stream. Keep the newest reading,
    // while allowing legacy updates before Parallax reports or after it stops.
    if (timestampOrderedFields.includes(key) && prev) {
      const previousAt = Date.parse((prev as TimeStampedValue).timeStamp);
      const incomingAt = Date.parse(record.timeStamp);
      if (Number.isFinite(previousAt) && Number.isFinite(incomingAt) && incomingAt < previousAt)
        continue;
    }
    cached[key] = incoming;
    if (JSON.stringify(prev) !== JSON.stringify(incoming)) changed.push(key);
  }
  return changed;
}

export function stateValue(state: VehicleState, key: string): string | number | null {
  const record = state[key] as TimeStampedValue | undefined;
  if (!record || !('value' in record)) return null;
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

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
