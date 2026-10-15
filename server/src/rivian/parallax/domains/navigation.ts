/** `navigation.*`: the vehicle's active route. */
import { defineRvm } from '../define.js';
import { decodePayload, type Fields } from '../wire.js';

export const RVM_TRIP_INFO = 'navigation.navigation_service.trip_info';
export const RVM_TRIP_PROGRESS = 'navigation.navigation_service.trip_progress';

export interface TripInfo {
  destination: { name: string | null; lat: number; lon: number };
  totalDistanceKm: number | null;
  totalDurationS: number | null;
  /** Battery % and range the navigation predicts on arrival. */
  arrivalSoc: number | null;
  arrivalRangeKm: number | null;
  /** Predicted arrival (ms since epoch). */
  arrivalAtMs: number | null;
  /** The planned route, as [lat, lon] points; null when it isn't sent. */
  route: [number, number][] | null;
}

/**
 * `trip_info` (`t70/v`), the active navigation route; empty when not
 * navigating. Resent as the prediction changes, and recalculated from the
 * vehicle's position on a reroute, so the totals cover what's left from
 * there. 2 origin {1 location, 5 start time, Unix ms}; 3 route {1 distance
 * m, 2 duration s, 3 stops {1 stop {1 location {1 lat, 2 lon}, 4 address,
 * 5 place id, 7 arrival SOC %, 8 arrival range m, 9 {1 arrival, s since
 * epoch}}}, 4 legs {3 main road, 4 polyline}, 6 arrival SOC %, 7 arrival
 * range m, 10 polyline}; 4 route preferences; 5 SOC % at the start; 6 {1
 * arrival, s since epoch}. Polylines are Google's encoding at 5 decimal
 * places. On an R1S (2026-10-14), 3.6 predicted 57.5% and legacy read
 * 57.7% a kilometre out; an earlier capture had arrival SOC and range at the top level, in
 * 6 and 7, so those are read too.
 */
export function decodeTripInfo(payloadBase64: string): TripInfo | null {
  const m = decodePayload(payloadBase64);
  const route = m?.message(3);
  const stop = route?.message(3)?.message(1);
  const location = stop?.message(1);
  const lat = location?.double(1);
  const lon = location?.double(2);
  if (!m || lat == null || lon == null) return null;
  const rangeM = route?.double(7) ?? m.double(7) ?? stop?.double(8);
  const arrivalS = stop?.message(9)?.int(1) ?? m.message(6)?.int(1);
  return {
    destination: { name: stop?.string(4) || null, lat, lon },
    totalDistanceKm: route?.double(1) != null ? route.double(1)! / 1000 : null,
    totalDurationS: route?.double(2) ?? null,
    arrivalSoc: route?.double(6) ?? m.double(6) ?? stop?.double(7) ?? null,
    arrivalRangeKm: rangeM != null ? rangeM / 1000 : null,
    arrivalAtMs: arrivalS && arrivalS > 0 ? arrivalS * 1000 : null,
    route: routeLine(route),
  };
}

/** The route's polyline, or its legs' joined; null when there's no line to draw. */
function routeLine(route: Fields | null | undefined): [number, number][] | null {
  if (!route) return null;
  const whole = route.string(10);
  const points = whole
    ? decodePolyline(whole)
    : route.repeated(4).flatMap((leg) => decodePolyline(leg.string(4) ?? ''));
  return points.length > 1 ? points : null;
}

/** Google's encoded polyline format, at 5 decimal places, as [lat, lon] points. */
export function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let i = 0;
  let lat = 0;
  let lon = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (i >= encoded.length) return null;
      byte = encoded.charCodeAt(i++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < encoded.length) {
    const dLat = next();
    const dLon = next();
    if (dLat == null || dLon == null) break;
    lat += dLat;
    lon += dLon;
    points.push([lat / 1e5, lon / 1e5]);
  }
  return points;
}

export interface TripProgress {
  /** Estimated arrival (ms since epoch). */
  etaMs: number | null;
  remainingKm: number | null;
  remainingS: number | null;
}

/**
 * `trip_progress` (`t70/x`), sent every few seconds while navigating: 1
 * {1 ETA, s since epoch}, 2 {1 the same ETA}, 4 distance remaining (m), 5
 * time remaining (s), 6 the vehicle's fix {1 {1 lat, 2 lon}, 2 speed m/s,
 * 3 heading 0–360°, 5 time, Unix ms}. Field 6 matched legacy GPS on an
 * R1S (2026-10-14): position within about 2 s of travel, speed and heading
 * alike. It isn't read.
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
    '1': 'Update ID (new with each update)',
    '2.1.1': 'Origin latitude',
    '2.1.2': 'Origin longitude',
    '2.5': 'Start time (Unix ms)',
    '3.1': 'Route distance (m)',
    '3.2': 'Route duration (s)',
    '3.3.1.1.1': 'Stop latitude',
    '3.3.1.1.2': 'Stop longitude',
    '3.3.1.4': 'Stop address',
    '3.3.1.5': 'Stop place ID',
    '3.3.1.7': 'Stop arrival SOC (%)',
    '3.3.1.8': 'Stop arrival range (m)',
    '3.3.1.9.1': 'Stop arrival (s since epoch)',
    '3.4.1': 'Leg distance (m)',
    '3.4.2': 'Leg duration (s)',
    '3.4.3': 'Leg main road',
    '3.4.4': 'Leg polyline',
    '3.6': 'Arrival SOC (%)',
    '3.7': 'Arrival range (m)',
    '3.10': 'Route polyline',
    '4.3': 'Route setting: roads to avoid',
    '4.4': 'Route setting: charging networks shown',
    '5': 'SOC at start (%)',
    '6.1': 'Arrival (s since epoch)',
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
    '2.1': 'ETA again (s since epoch; same as 1.1)',
    '4': 'Distance remaining (m)',
    '5': 'Time remaining (s)',
    '6.1.1': 'Vehicle latitude',
    '6.1.2': 'Vehicle longitude',
    '6.2': 'Vehicle speed (m/s)',
    '6.3': 'Vehicle heading (°, 0–360)',
    '6.5': 'Vehicle fix time (Unix ms)',
  },
});

export const NAVIGATION_RVMS = [tripInfo, tripProgress] as const;
