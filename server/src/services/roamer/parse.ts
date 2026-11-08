import type { VehicleState } from '../../rivian/types.js';
import { DEFAULT_RADIUS_M, MAX_RADIUS_M, MIN_RADIUS_M } from '../locations.js';
import type {
  ChargeSegment,
  Destination,
  DriveSegment,
  Fix,
  ImportPlace,
} from '../imports/format.js';

type RoamerRecord = Record<string, unknown>;

/** Location metrics keep Rivian's GNSS speed, in m/s. */
const MPS_TO_KMH = 3.6;

/**
 * Vehicle metrics Roamer keeps as Rivian sent them, under Rivian's names in
 * snake case, with the values live state has. Ones it has recoded (seat
 * heat as 0–3, service mode and cold-battery limits as booleans, range
 * thresholds with a prefix) are left out rather than guessed back.
 */
const NUMBER_METRICS = [
  'vehicle_mileage',
  'battery_level',
  'distance_to_empty',
  'battery_capacity',
  'battery_limit',
  'cabin_climate_interior_temperature',
  'cabin_climate_driver_temperature',
  'tire_pressure_front_left',
  'tire_pressure_front_right',
  'tire_pressure_rear_left',
  'tire_pressure_rear_right',
];
const CLOSURES = ['frunk', 'liftgate', 'tailgate', 'tonneau', 'side_bin_left', 'side_bin_right'];
const SIDES = ['front_left', 'front_right', 'rear_left', 'rear_right'];
const TEXT_METRICS = [
  'power_state',
  'gear_status',
  'drive_mode',
  'charger_state',
  'charger_status',
  'charger_derate_status',
  'charge_port_state',
  'ota_current_version',
  'ota_available_version',
  'ota_status',
  'ota_current_status',
  'ota_install_ready',
  ...SIDES.flatMap((side) => [`door_${side}_locked`, `door_${side}_closed`]),
  ...CLOSURES.flatMap((closure) => [`closure_${closure}_locked`, `closure_${closure}_closed`]),
  ...SIDES.map((side) => `window_${side}_closed`),
  ...SIDES.map((side) => `tire_pressure_status_${side}`),
  'gear_guard_locked',
  'gear_guard_video_status',
  'pet_mode_status',
  'pet_mode_temperature_status',
  'cabin_preconditioning_status',
  'cabin_preconditioning_type',
  'defrost_defog_status',
  'twelve_volt_battery_health',
  'battery_hv_thermal_event',
];

const camel = (snake: string) => snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

const METRICS: readonly { column: string; field: string; kind: 'number' | 'text' }[] = [
  ...NUMBER_METRICS.map((column) => ({ column, field: camel(column), kind: 'number' as const })),
  ...TEXT_METRICS.map((column) => ({ column, field: camel(column), kind: 'text' as const })),
];

/** Every field `metricState` can write. */
export const METRIC_STATE_FIELDS: readonly string[] = METRICS.map((m) => m.field);

/** Charging metrics' state while power is flowing (Parallax's `charging_active`). */
const CHARGING_ACTIVE = 3;

/** A number; Postgres numerics can come as strings. Anything else is no reading. */
export function num(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;
const round = (n: number | null, places: number): number | null =>
  n == null ? null : Math.round(n * 10 ** places) / 10 ** places;

/** An instant: Roamer's times are all UTC, with or without a suffix. */
export function instant(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const at = Date.parse(/(Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`);
  return Number.isFinite(at) ? at : null;
}

/** A vehicle metric's readings as vehicle state, stamped at `at`. */
export function metricState(record: RoamerRecord, at: number): VehicleState {
  const timeStamp = new Date(at).toISOString();
  const state: VehicleState = {};
  for (const { column, field, kind } of METRICS) {
    const value = kind === 'number' ? num(record[column]) : text(record[column]);
    if (value != null) state[field] = { value, timeStamp };
  }
  return state;
}

/** A location metric's fix, or null without a usable position. */
export function fixOf(record: RoamerRecord): Fix | null {
  const lat = num(record['latitude']);
  const lon = num(record['longitude']);
  if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const speed = num(record['speed']);
  return {
    lat,
    lon,
    speedKmh: round(speed == null ? null : speed * MPS_TO_KMH, 2),
    altitudeM: num(record['altitude']),
    bearing: num(record['bearing']),
  };
}

/** A drive session; null for one Roamer flagged as corrupted, or without a start and end. */
export function driveOf(record: RoamerRecord): DriveSegment | null {
  const startedAt = instant(record['started_at']);
  const endedAt = instant(record['ended_at']);
  if (record['is_corrupted'] === true || startedAt == null || endedAt == null) return null;
  const odometerM = (column: string) => {
    const km = num(record[column]);
    return km == null ? null : Math.round(km * 1000);
  };
  return {
    startedAt,
    endedAt,
    start: {
      mileageM: odometerM('start_odometer'),
      battery: num(record['start_battery_level']),
      rangeKm: num(record['start_range']),
      lat: num(record['start_latitude']),
      lon: num(record['start_longitude']),
    },
    end: {
      mileageM: odometerM('end_odometer'),
      battery: num(record['end_battery_level']),
      rangeKm: num(record['end_range']),
      lat: num(record['end_latitude']),
      lon: num(record['end_longitude']),
    },
    // Not kept with the session: read from the metrics at its start.
    batteryCapacityKwh: null,
    driveMode: text(record['drive_mode_override']) ?? text(record['primary_drive_mode']),
    distanceKm: round(num(record['total_distance']), 3),
    elevationGainM: round(num(record['elevation_gain']), 1),
    elevationLossM: round(num(record['elevation_loss']), 1),
    driverName: text(record['primary_driver_profile'])?.trim() ?? null,
    // Not kept with the session: read from the navigation metrics.
    destination: null,
  };
}

/** The time a session's periods spent charging, in seconds. */
function periodSeconds(periods: unknown): number | null {
  if (!Array.isArray(periods) || periods.length === 0) return null;
  let total = 0;
  for (const period of periods as RoamerRecord[]) {
    const from = instant(period?.['started_at']);
    const to = instant(period?.['ended_at']);
    if (from == null || to == null) return null;
    total += Math.max(0, to - from) / 1000;
  }
  return total;
}

/** A charging session, with no curve yet; null for a corrupted one, or one still open. */
export function chargeOf(record: RoamerRecord): ChargeSegment | null {
  const startedAt = instant(record['started_at']);
  const endedAt = instant(record['ended_at']);
  if (record['is_corrupted'] === true || startedAt == null || endedAt == null) return null;
  const minutes = num(record['duration_minutes']);
  return {
    startedAt,
    endedAt,
    chargingSeconds: Math.round(
      periodSeconds(record['periods']) ?? (minutes == null ? 0 : minutes * 60),
    ),
    startSoc: round(num(record['start_battery_level']), 1),
    endSoc: round(num(record['end_battery_level']), 1),
    energyKwh: round(num(record['total_energy_kwh']), 3),
    packKwh: round(num(record['pack_kwh']), 3),
    thermalKwh: round(num(record['thermal_kwh']), 3),
    rangeAddedKm: round(num(record['kilometers_added']), 3),
    avgPowerKw: round(num(record['average_power_kw']), 2),
    maxPowerKw: round(num(record['max_power_kw']), 2),
    lat: num(record['latitude']),
    lon: num(record['longitude']),
    curve: [],
  };
}

/** A charging metric's power, if power was flowing. */
export function chargingPower(record: RoamerRecord): number | null {
  return num(record['state']) === CHARGING_ACTIVE ? round(num(record['power_kw']), 2) : null;
}

/** A saved place; `home` is whether Roamer's Home favourite points at it. */
export function placeOf(record: RoamerRecord, home: boolean): ImportPlace | null {
  const name = text(record['name'])?.trim();
  const lat = num(record['latitude']);
  const lon = num(record['longitude']);
  if (!name || lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return null;
  }
  const radius = num(record['radius_meters']) ?? DEFAULT_RADIUS_M;
  const cents = num(record['price_per_kwh_minor']);
  return {
    name,
    lat,
    lon,
    radiusM: Math.round(Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, radius))),
    isHome: home,
    ratePerKwh: cents == null ? null : cents / 100,
  };
}

/** Where the navigation was headed as of a navigation metric; null when it wasn't navigating. */
export function navigationOf(record: RoamerRecord): { at: number; to: Destination | null } | null {
  const at = instant(record['observed_at']);
  if (at == null) return null;
  const name = text(record['destination_name']);
  const lat = num(record['destination_latitude']);
  const lon = num(record['destination_longitude']);
  const navigating =
    record['navigation_active'] === true && name != null && lat != null && lon != null;
  return { at, to: navigating ? { name: name!, lat: lat!, lon: lon! } : null };
}

/**
 * Each drive's destination, as live recording keeps it: where the
 * navigation was headed as the drive set off, or later during it, the last
 * one it heard of winning. Both lists are in time order.
 */
export function destinationsFor(
  drives: readonly DriveSegment[],
  navigation: readonly { at: number; to: Destination | null }[],
): (Destination | null)[] {
  let i = 0;
  let current: Destination | null = null;
  return drives.map((drive) => {
    while (i < navigation.length && navigation[i]!.at <= drive.startedAt)
      current = navigation[i++]!.to;
    let found = current;
    while (i < navigation.length && navigation[i]!.at <= drive.endedAt) {
      current = navigation[i++]!.to;
      found = current ?? found;
    }
    return found;
  });
}
