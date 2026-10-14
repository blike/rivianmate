/** `navigation.*`: the vehicle's active route. */
import { defineRvm } from '../define.js';
import { decodePayload } from '../wire.js';

export const RVM_TRIP_INFO = 'navigation.navigation_service.trip_info';
export const RVM_TRIP_PROGRESS = 'navigation.navigation_service.trip_progress';

export interface TripInfo {
  destination: { name: string | null; lat: number; lon: number };
  totalDistanceKm: number | null;
  totalDurationS: number | null;
  /** Battery % and range the navigation predicts on arrival. */
  arrivalSoc: number | null;
  arrivalRangeKm: number | null;
}

/**
 * `trip_info` (`t70/v`), the active navigation route; empty when not
 * navigating. 3 route {1 distance m, 2 duration s, 3 stops {1 stop {1
 * location {1 lat, 2 lon}, 4 address, 5 place id}}}, 6 arrival SOC %, 7
 * arrival range (m). Read from a live trip: 30.8 km / 37 min to an address,
 * arriving at 63% (from 69.8%) with 339 km of range.
 */
export function decodeTripInfo(payloadBase64: string): TripInfo | null {
  const m = decodePayload(payloadBase64);
  const route = m?.message(3);
  const stop = route?.message(3)?.message(1);
  const location = stop?.message(1);
  const lat = location?.double(1);
  const lon = location?.double(2);
  if (!m || lat == null || lon == null) return null;
  const rangeM = m.double(7);
  return {
    destination: { name: stop?.string(4) || null, lat, lon },
    totalDistanceKm: route?.double(1) != null ? route.double(1)! / 1000 : null,
    totalDurationS: route?.double(2) ?? null,
    arrivalSoc: m.double(6),
    arrivalRangeKm: rangeM != null ? rangeM / 1000 : null,
  };
}

export interface TripProgress {
  /** Estimated arrival (ms since epoch). */
  etaMs: number | null;
  remainingKm: number | null;
  remainingS: number | null;
}

/**
 * `trip_progress` (`t70/x`), sent every few seconds while navigating: 1
 * {1 ETA, s since epoch}, 4 distance remaining (m), 5 time remaining (s).
 * Rivian keeps the last progress after a trip ends, so it only means
 * anything alongside a trip_info.
 */
export function decodeTripProgress(payloadBase64: string): TripProgress | null {
  const m = decodePayload(payloadBase64);
  if (!m) return null;
  const eta = m.message(1)?.int(1);
  const remainingM = m.double(4);
  return {
    etaMs: eta && eta > 0 ? eta * 1000 : null,
    remainingKm: remainingM != null ? remainingM / 1000 : null,
    remainingS: m.double(5),
  };
}

export const tripInfo = defineRvm({
  rvm: RVM_TRIP_INFO,
  group: 'core',
  maturity: 'confirmed',
  decode: decodeTripInfo,
  store: 'latest',
  fieldNames: {
    '3.1': 'Route distance (m)',
    '3.2': 'Route duration (s)',
    '3.3.1.1.1': 'Stop latitude',
    '3.3.1.1.2': 'Stop longitude',
    '3.3.1.4': 'Stop address',
    '3.3.1.5': 'Stop place ID',
    '6': 'Arrival SOC (%)',
    '7': 'Arrival range (m)',
  },
});

export const tripProgress = defineRvm({
  rvm: RVM_TRIP_PROGRESS,
  group: 'core',
  maturity: 'confirmed',
  decode: decodeTripProgress,
  store: 'latest',
  fieldNames: {
    '1.1': 'ETA (s since epoch)',
    '4': 'Distance remaining (m)',
    '5': 'Time remaining (s)',
  },
});

export const NAVIGATION_RVMS = [tripInfo, tripProgress] as const;
