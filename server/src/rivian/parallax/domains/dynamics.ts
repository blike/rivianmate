/** `dynamics.*`: position, tires, gear, odometer, range, drive mode and brake fluid. */
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
  /** m/s, as VehicleState's consumers expect. */
  speedMps: number | null;
}

/**
 * `dynamics.vehicle.gnss`: 1/2 latitude/longitude, 3 altitude (m), 4 speed
 * (m/s; left out at a standstill, so a fix without it is 0), 5 heading
 * (-180 to 180, normalized to 0–360), 6–9 error estimates, 10 fix time (GPS
 * time on an R1S, 18 s ahead of UTC; not read).
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
 * `dynamics.tires.state`: repeated 2, each 1 position (1–4: FL, FR, RL,
 * RR), 2 status (1 OK; 2–4 warnings, read as Warning), 3 pressure (bar), 4
 * validity, 5 reading time. A tire not marked valid (0) repeats an old
 * reading, so it's skipped rather than stamped as new.
 */
export function decodeTires(payloadBase64: string): TireReading[] {
  const readings: TireReading[] = [];
  for (const tire of decodePayload(payloadBase64)?.repeated(2) ?? []) {
    const suffix = TIRE_POSITION_SUFFIX[tire.int(1) ?? 0];
    if (!suffix || (tire.int(4) ?? 0) !== 0) continue;
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
    '6': 'Position error, horizontal (m)',
    '7': 'Position error, vertical (m)',
    '8': 'Speed error (m/s)',
    '9': 'Heading error (°)',
    '10': 'Fix time (ms; GPS time on an R1S, 18 s ahead of UTC)',
  },
});

export const tires = defineRvm({
  rvm: RVM_TIRES,
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
    '2.2': 'Tire: status (1 OK, 2 hard, 3 soft, 4 puncture warning)',
    '2.3': 'Tire: pressure (bar)',
    '2.4': 'Tire: reading valid (0 valid, 1 stale)',
    '2.5': 'Tire: reading time (Unix ms)',
  },
});

/** `dynamics.vehicle.gear`: 1 gear (1 park, 2 reverse, 3 neutral, 4 drive). */
export const gear = defineRvm({
  rvm: RVM_GEAR,
  decode: (payload) =>
    readings((put) => put('gearStatus', GEARS[fieldsOrEmpty(payload)?.int(1) ?? 0])),
  toState: stampReadings,
  stateKeys: ['gearStatus'],
  fieldNames: { '1': 'Gear (1 park, 2 reverse, 3 neutral, 4 drive)' },
});

/**
 * `dynamics.vehicle.odometer`: 1 odometer (whole km), as legacy
 * vehicleMileage in metres; legacy's is preferred where it has one.
 */
export const odometer = defineRvm({
  rvm: RVM_ODOMETER,
  decode: (payload) =>
    readings((put) => {
      const km = fieldsOrEmpty(payload)?.int(1);
      if (km != null && km > 0 && km <= 2_000_000) put('vehicleMileage', km * 1000);
    }),
  toState: stampReadings,
  stateKeys: ['vehicleMileage'],
  fieldNames: { '1': 'Odometer (km)' },
});

const RANGE_THRESHOLDS: Record<number, string> = {
  1: 'normal',
  2: 'low',
  3: 'red',
  4: 'critically_low',
};
const RANGE_TEMPERATURE_IMPACTS: Record<number, string> = {
  1: 'normal',
  2: 'cold_may_impact',
  3: 'cold_impact',
};

/**
 * `dynamics.vehicle.range`: 1 range (km), as legacy distanceToEmpty; 2 how
 * low it is and 3 the cold's effect, named after the app's as legacy lacks
 * them. A message without field 1 isn't read as 0 km.
 */
export const range = defineRvm({
  rvm: RVM_RANGE,
  decode: (payload) =>
    readings((put) => {
      const m = fieldsOrEmpty(payload);
      const km = m?.int(1);
      if (km != null && km >= 0 && km <= 2000) put('distanceToEmpty', km);
      put('rangeThreshold', RANGE_THRESHOLDS[m?.int(2) ?? 0]);
      put('rangeTemperatureImpact', RANGE_TEMPERATURE_IMPACTS[m?.int(3) ?? 0]);
    }),
  toState: stampReadings,
  stateKeys: ['distanceToEmpty', 'rangeThreshold', 'rangeTemperatureImpact'],
  store: true,
  fieldNames: {
    '1': 'Range (km)',
    '2': 'Range level (1 normal, 2 low, 3 red, 4 critically low)',
    '3': 'Cold effect (1 none, 2 may reduce range, 3 reducing range)',
  },
});

/** Legacy's driveMode spellings. */
const DRIVE_MODES: Record<number, string> = {
  1: 'init_mode',
  2: 'everyday',
  3: 'off_road_snow_ice',
  4: 'off_road_sport_auto',
  5: 'off_road_sport_drift',
  6: 'sport_launch',
  7: 'fault',
  8: 'sport',
  9: 'distance',
  10: 'towing',
  11: 'off_road_auto',
  12: 'off_road_sand',
  13: 'off_road_rocks',
  14: 'off_road_mud',
  15: 'winter',
};

/** `dynamics.vehicle.drive_mode`: 1 mode, as legacy driveMode. */
export const driveMode = defineRvm({
  rvm: 'dynamics.vehicle.drive_mode',
  decode: (payload) =>
    readings((put) => put('driveMode', DRIVE_MODES[fieldsOrEmpty(payload)?.int(1) ?? 0])),
  toState: stampReadings,
  stateKeys: ['driveMode'],
  store: true,
  fieldNames: {
    '1': 'Mode (2 all-purpose, 3 snow, 8 sport, 9 conserve, 10 towing, 11–14 off-road, 15 winter…)',
    '8': 'Acceleration limited by cold',
    '9': 'Regen limited by cold',
  },
});

const BRAKE_FLUID_LOW: Record<number, string> = { 1: 'false', 2: 'true' };

/** `dynamics.brakes.fluid_level`: 1 low (1 no, 2 yes), as legacy brakeFluidLow. */
export const brakeFluid = defineRvm({
  rvm: 'dynamics.brakes.fluid_level',
  decode: (payload) =>
    readings((put) => put('brakeFluidLow', BRAKE_FLUID_LOW[fieldsOrEmpty(payload)?.int(1) ?? 0])),
  toState: stampReadings,
  stateKeys: ['brakeFluidLow'],
  store: true,
  fieldNames: { '1': 'Brake fluid low (1 no, 2 yes)' },
});

// Probes: archived to be worked out; nothing reads them yet.
export const knownLocation = defineRvm({
  rvm: 'dynamics.vehicle.location',
  store: true,
  fieldNames: { '1': 'Known place (1 none, 2 home, 3 work)' },
});

export const efficiency = defineRvm({
  rvm: 'dynamics.vehicle.efficiency',
  store: true,
  fieldNames: {
    '1': 'Efficiency (Wh/km, for range estimates)',
    '2': 'Unknown (Wh/km)',
    '3.1': 'History: entry (1–10)',
    '3.2': 'History: efficiency (Wh/km)',
  },
});

export const massEstimate = defineRvm({
  rvm: 'dynamics.vehicle.mass_estimate',
  store: true,
  fieldNames: { '1': 'Mass (kg)' },
});

export const DYNAMICS_RVMS = [
  gnss,
  tires,
  gear,
  odometer,
  range,
  driveMode,
  knownLocation,
  efficiency,
  massEstimate,
  brakeFluid,
] as const;
