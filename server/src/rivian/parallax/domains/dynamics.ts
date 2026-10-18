/** `dynamics.*`: position, tires, gear, odometer and range. */
import type { VehicleState } from '../../types.js';
import { defineRvm, fieldsOrEmpty, readings, stampReadings } from '../define.js';
import { decodePayload } from '../wire.js';

export const RVM_GNSS = 'dynamics.vehicle.gnss';
export const RVM_TIRES = 'dynamics.tires.state';
export const RVM_GEAR = 'dynamics.vehicle.gear';
export const RVM_ODOMETER = 'dynamics.vehicle.odometer';
export const RVM_RANGE = 'dynamics.vehicle.range';

export interface GnssReading {
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  bearing: number | null;
  /** m/s — matches what location-writer.ts/drive-detector.ts/vehicleStatus.ts expect; don't convert to km/h here. */
  speedMps: number | null;
}

/**
 * `dynamics.vehicle.gnss`: 1/2 latitude/longitude (double, degrees), 3
 * altitude (double, meters), 5 heading (float, signed -180..180 — a raw
 * -80.6 doesn't fit 0-360, so normalized to a 0-360 compass bearing here),
 * 4 speed (float, m/s, as VehicleState consumers expect; proto3 leaves it
 * out at a standstill, so a fix without it is 0). Speed matched legacy
 * gnssSpeed from 0 to 22 m/s on an R1S (2026-10-13); 6, read as speed
 * before, stays 0.1–4.9 parked or moving. 10 is the fix time in GPS time
 * (ms since 1980-01-06, no leap seconds): converted to Unix time it runs a
 * median 17.8 s ahead of the message, GPS time's 18 leap seconds (R1S,
 * 2026-10-13); it isn't read. No .proto; other field numbers from a live
 * capture against a real R2 (2026-09-29/30), not community docs.
 */
export function decodeGnss(payloadBase64: string): GnssReading | null {
  const m = decodePayload(payloadBase64);
  if (!m) return null;
  const bearing = m.float(5);
  const latitude = m.double(1);
  return {
    latitude,
    longitude: m.double(2),
    altitude: m.double(3),
    bearing: bearing != null ? ((bearing % 360) + 360) % 360 : null,
    speedMps: m.float(4) ?? (latitude != null ? 0 : null),
  };
}

const TIRE_POSITION_SUFFIX: Record<number, string> = {
  1: 'FrontLeft',
  2: 'FrontRight',
  3: 'RearLeft',
  4: 'RearRight',
};

export interface TireReading {
  position: string;
  pressureBar: number | null;
  status: 'OK' | 'Warning' | null;
}

/**
 * `dynamics.tires.state`: repeated field 2, each a nested message with
 * 1 position (1-4 → FL/FR/RL/RR), 2 status (1=OK, else Warning), 3 pressure
 * (double, bar), 5 reading time (Unix ms; a median 0.8 s before the
 * message on an R1S, 2026-10-13, not read). Field numbers from a live
 * capture against a real R2 (2026-09-29), not community docs.
 */
export function decodeTires(payloadBase64: string): TireReading[] {
  const readings: TireReading[] = [];
  for (const tire of decodePayload(payloadBase64)?.repeated(2) ?? []) {
    const suffix = TIRE_POSITION_SUFFIX[tire.int(1) ?? 0];
    if (!suffix) continue;
    const status = tire.int(2);
    readings.push({
      position: suffix,
      pressureBar: tire.double(3),
      status: status == null ? null : status === 1 ? 'OK' : 'Warning',
    });
  }
  return readings;
}

const GEARS: Record<number, string> = { 1: 'park', 2: 'reverse', 3: 'neutral', 4: 'drive' };

export const gnss = defineRvm({
  rvm: RVM_GNSS,
  group: 'dynamics',
  maturity: 'confirmed',
  decode: decodeGnss,
  toState(reading, timeStamp) {
    const state: VehicleState = {};
    if (reading.latitude != null && reading.longitude != null) {
      state.gnssLocation = { latitude: reading.latitude, longitude: reading.longitude, timeStamp };
    }
    if (reading.altitude != null) state.gnssAltitude = { timeStamp, value: reading.altitude };
    if (reading.bearing != null) state.gnssBearing = { timeStamp, value: reading.bearing };
    if (reading.speedMps != null) state.gnssSpeed = { timeStamp, value: reading.speedMps };
    return state;
  },
  stateKeys: ['gnssLocation', 'gnssAltitude', 'gnssBearing', 'gnssSpeed'],
  fieldNames: {
    '1': 'Latitude',
    '2': 'Longitude',
    '3': 'Altitude (m)',
    '4': 'Speed (m/s; left out when stopped)',
    '5': 'Heading (°, −180 to 180)',
    '10': 'Fix time (GPS time, ms since 1980-01-06; 18 s ahead of UTC)',
  },
});

export const tires = defineRvm({
  rvm: RVM_TIRES,
  group: 'dynamics',
  maturity: 'confirmed',
  decode: decodeTires,
  toState(tires, timeStamp) {
    const state: VehicleState = {};
    for (const tire of tires) {
      if (tire.pressureBar != null) {
        state[`tirePressure${tire.position}`] = { timeStamp, value: tire.pressureBar };
      }
      if (tire.status != null) {
        state[`tirePressureStatus${tire.position}`] = { timeStamp, value: tire.status };
      }
    }
    return state;
  },
  stateKeys: Object.values(TIRE_POSITION_SUFFIX).flatMap((p) => [
    `tirePressure${p}`,
    `tirePressureStatus${p}`,
  ]),
  entryLabels: {
    field: 2,
    key: 1,
    labels: { 1: 'Front left', 2: 'Front right', 3: 'Rear left', 4: 'Rear right' },
  },
  fieldNames: {
    '2.1': 'Tire: position (1–4 = FL, FR, RL, RR)',
    '2.2': 'Tire: status (1 = OK)',
    '2.3': 'Tire: pressure (bar)',
    '2.5': 'Tire: reading time (Unix ms)',
  },
});

/** `dynamics.vehicle.gear`: 1 gear (1 park, 2 reverse, 3 neutral, 4 drive). */
export const gear = defineRvm({
  rvm: RVM_GEAR,
  group: 'vehicleState',
  maturity: 'partial',
  decode: (payload) =>
    readings((put) => put('gearStatus', GEARS[fieldsOrEmpty(payload)?.int(1) ?? 0])),
  toState: stampReadings,
  stateKeys: ['gearStatus'],
  fieldNames: { '1': 'Gear (1 park, 2 reverse, 3 neutral, 4 drive)' },
});

/**
 * `dynamics.vehicle.odometer`: 1 odometer (whole km), as legacy
 * vehicleMileage in metres. Coarser than legacy's metres, so legacy's is
 * used wherever it has one (LEGACY_PREFERRED_FIELDS); an R2 has none.
 */
export const odometer = defineRvm({
  rvm: RVM_ODOMETER,
  group: 'vehicleState',
  maturity: 'partial',
  decode: (payload) =>
    readings((put) => {
      const km = fieldsOrEmpty(payload)?.int(1);
      if (km != null && km > 0 && km <= 2_000_000) put('vehicleMileage', km * 1000);
    }),
  toState: stampReadings,
  stateKeys: ['vehicleMileage'],
  fieldNames: { '1': 'Odometer (km)' },
});

/**
 * `dynamics.vehicle.range`: 1 range (km), read as legacy distanceToEmpty
 * only with 2 at 1, as captured beside a matching legacy reading (282, 2
 * and 3 both 1; their meaning is unknown, and 2 may be a unit).
 */
export const range = defineRvm({
  rvm: RVM_RANGE,
  group: 'vehicleState',
  maturity: 'confirmed',
  decode: (payload) =>
    readings((put) => {
      const m = fieldsOrEmpty(payload);
      const km = m?.int(1);
      if (m?.int(2) === 1 && km != null && km >= 0 && km <= 2000) put('distanceToEmpty', km);
    }),
  toState: stampReadings,
  stateKeys: ['distanceToEmpty'],
  store: true,
  fieldNames: {
    '1': 'Range (km)',
  },
});

export const DYNAMICS_RVMS = [gnss, tires, gear, odometer, range] as const;
