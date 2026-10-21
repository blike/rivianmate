/**
 * Pure mapping from TeslaMate's tables to RivianMate's API shapes, so a
 * Tesla shows on the same pages as a Rivian. TeslaMate stores metric units
 * (km, °C, bar, kW), as RivianMate does.
 */
import type {
  ChargingSessionDto,
  DriveDto,
  DrivePlaceDto,
  StateSpanDto,
  VehicleDto,
} from '../api-types.js';
import type { LiveSessionData, TimeStampedValue, VehicleState } from '../rivian/types.js';
import { elevationChange } from '../services/drive-metrics.js';
import {
  type ChargingSettings,
  type SavedLocation,
  type Spot,
  estimateCost,
  nearbySpot,
  sessionPlace,
  sessionRate,
} from '../services/locations.js';
import { reportedCapacity } from '../services/reported-capacity.js';
import { haversineKm } from '../services/state-utils.js';
import { teslamateVehicleId } from './ids.js';

/** Saved locations and wallboxes, for naming places and pricing charges as for a Rivian. */
export interface Places {
  settings: ChargingSettings;
  locations: readonly SavedLocation[];
  wallboxes: readonly Spot[];
}

/** TeslaMate's "preferred range" setting: which range estimate to show. */
export type RangeKind = 'rated' | 'ideal';

export interface CarRow {
  id: number;
  name: string | null;
  model: string | null;
  marketing_name: string | null;
  vin: string | null;
  /** kWh per km, as TeslaMate derives it; null until it has enough charges. */
  efficiency: number | null;
}

export interface PositionRow {
  date: Date;
  latitude: number | null;
  longitude: number | null;
  speed: number | null;
  power: number | null;
  odometer: number | null;
  ideal_battery_range_km: number | null;
  rated_battery_range_km: number | null;
  battery_level: number | null;
  usable_battery_level: number | null;
  outside_temp: number | null;
  inside_temp: number | null;
  driver_temp_setting: number | null;
  passenger_temp_setting: number | null;
  /** Fan speed, 0 (off) to 11 (Tesla's top speed). */
  fan_status: number | null;
  is_climate_on: boolean | null;
  is_front_defroster_on: boolean | null;
  is_rear_defroster_on: boolean | null;
  elevation: number | null;
  tpms_pressure_fl: number | null;
  tpms_pressure_fr: number | null;
  tpms_pressure_rl: number | null;
  tpms_pressure_rr: number | null;
}

export interface StateRow {
  state: 'online' | 'offline' | 'asleep';
  start_date: Date;
  end_date: Date | null;
}

export interface ChargeRow {
  date: Date;
  battery_level: number | null;
  charge_energy_added: number | null;
  charger_power: number | null;
  charger_voltage: number | null;
  charger_actual_current: number | null;
  fast_charger_present: boolean | null;
  ideal_battery_range_km: number | null;
  rated_battery_range_km: number | null;
}

export interface ActiveChargeRow {
  id: number;
  start_date: Date;
  start_battery_level: number | null;
  start_ideal_range_km: number | null;
  start_rated_range_km: number | null;
}

/** Everything read for one car on a poll. */
export interface CarSnapshot {
  /** Latest position with battery and range readings (a full vehicle report). */
  full: PositionRow | null;
  /** Latest position of the drive under way, which streams location only. */
  moving: PositionRow | null;
  state: StateRow | null;
  /** The drive under way, if any. */
  driveId: number | null;
  charging: { process: ActiveChargeRow; latest: ChargeRow | null } | null;
  version: { version: string; at: Date } | null;
}

export interface AddressRow {
  name: string | null;
  house_number: string | null;
  road: string | null;
  city: string | null;
  display_name: string | null;
}

const MODEL_NAMES: Record<string, string> = {
  S: 'Model S',
  '3': 'Model 3',
  X: 'Model X',
  Y: 'Model Y',
};

/** TeslaMate stores the model as a letter ("3"); Cybertruck and others as named. */
export function modelName(model: string | null): string | null {
  if (!model) return null;
  return MODEL_NAMES[model.toUpperCase()] ?? model;
}

/** VIN position 10 encodes the model year; letters skip I, O, Q, U and Z. */
const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY';

export function vinModelYear(vin: string | null): number | null {
  const code = vin?.length === 17 ? vin[9]!.toUpperCase() : null;
  if (!code) return null;
  const letter = YEAR_CODES.indexOf(code);
  if (letter >= 0) return 2010 + letter;
  if (code >= '1' && code <= '9') return 2031 + Number(code) - 1;
  return null;
}

export function toVehicleDto(car: CarRow): VehicleDto {
  const model = modelName(car.model);
  return {
    id: teslamateVehicleId(car.id),
    vin: car.vin ?? '',
    name: car.name || model,
    make: 'Tesla',
    model,
    modelYear: vinModelYear(car.vin),
    // Rivian's renders only.
    renders: [],
    source: 'teslamate',
  };
}

const rangeOf = (
  row: { ideal_battery_range_km: number | null; rated_battery_range_km: number | null } | null,
  kind: RangeKind,
) => (kind === 'ideal' ? row?.ideal_battery_range_km : row?.rated_battery_range_km) ?? null;

function newest<T extends { date: Date }>(...rows: (T | null | undefined)[]): T | null {
  let best: T | null = null;
  for (const row of rows) if (row && (!best || row.date > best.date)) best = row;
  return best;
}

/** Newest non-null reading of `pick` among the rows, with its time. */
function latestValue<T extends { date: Date }>(
  rows: (T | null | undefined)[],
  pick: (row: T) => number | string | boolean | null | undefined,
): TimeStampedValue | undefined {
  let best: { at: Date; value: number | string } | undefined;
  for (const row of rows) {
    if (!row) continue;
    const raw = pick(row);
    if (raw == null) continue;
    const value = typeof raw === 'boolean' ? String(raw) : raw;
    if (!best || row.date > best.at) best = { at: row.date, value };
  }
  return best ? { timeStamp: best.at.toISOString(), value: best.value } : undefined;
}

const CHARGING = 'chrgr_sts_connected_charging';
const PLUGGED = 'chrgr_sts_connected_no_chrg';
const UNPLUGGED = 'chrgr_sts_not_connected';

export function isCharging(latest: ChargeRow | null | undefined): boolean {
  return (latest?.charger_power ?? 0) > 0;
}

/**
 * The car's state in the shape the dashboard reads, using the Rivian field
 * names it already understands. Fields TeslaMate doesn't log (locks,
 * closures, charge limit) are left out rather than guessed.
 */
export function buildVehicleState(snap: CarSnapshot, range: RangeKind): VehicleState {
  const { full, moving, state, charging } = snap;
  const driving = snap.driveId != null;
  const charge = charging?.latest ?? null;
  const fixes = [full, driving ? moving : null];
  const where = newest(...fixes.filter((p) => p?.latitude != null && p.longitude != null));
  const levelRows: { date: Date; level: number | null; range: number | null }[] = [
    ...(full ? [{ date: full.date, level: full.battery_level, range: rangeOf(full, range) }] : []),
    ...(charge
      ? [{ date: charge.date, level: charge.battery_level, range: rangeOf(charge, range) }]
      : []),
  ];

  const out: VehicleState = {};
  const set = (key: string, value: TimeStampedValue | undefined) => {
    if (value) out[key] = value;
  };
  const stamp = (date: Date, value: string | number) => ({
    timeStamp: date.toISOString(),
    value,
  });

  set(
    'batteryLevel',
    latestValue(levelRows, (r) => r.level),
  );
  set(
    'distanceToEmpty',
    latestValue(levelRows, (r) => r.range),
  );
  set(
    'vehicleMileage',
    latestValue(fixes, (p) => (p.odometer != null ? p.odometer * 1000 : null)),
  );
  if (where) {
    out.gnssLocation = {
      latitude: where.latitude!,
      longitude: where.longitude!,
      timeStamp: where.date.toISOString(),
    };
    set(
      'gnssAltitude',
      latestValue([where], (p) => p.elevation),
    );
    // m/s, as Rivian reports it; only meaningful while driving.
    out.gnssSpeed = stamp(where.date, driving ? (where.speed ?? 0) / 3.6 : 0);
  }

  const asleep = state != null && state.end_date == null && state.state !== 'online';
  const latestAt = newest<{ date: Date }>(full, moving, charge)?.date ?? state?.start_date;
  if (state) {
    out.powerState = stamp(
      driving ? (latestAt ?? state.start_date) : state.start_date,
      driving ? 'go' : asleep ? 'sleep' : 'ready',
    );
  }
  if (latestAt) {
    out.gearStatus = stamp(latestAt, driving ? 'drive' : 'park');
    out.chargerStatus = stamp(
      charge?.date ?? latestAt,
      charging ? (isCharging(charge) ? CHARGING : PLUGGED) : UNPLUGGED,
    );
    out.cloudConnection = {
      lastSync: latestAt.toISOString(),
      isOnline: state?.state === 'online' && state.end_date == null,
    };
  }

  set(
    'cabinClimateInteriorTemperature',
    latestValue([full], (p) => p.inside_temp),
  );
  set(
    'cabinClimateDriverTemperature',
    latestValue([full], (p) => p.driver_temp_setting),
  );
  set(
    'cabinClimatePassengerTemperature',
    latestValue([full], (p) => p.passenger_temp_setting),
  );
  set(
    'climateFanSpeed',
    latestValue([full], (p) => p.fan_status),
  );
  set(
    'outsideTemperature',
    latestValue([full], (p) => p.outside_temp),
  );
  set(
    'climateOn',
    latestValue([full], (p) => p.is_climate_on),
  );
  set(
    'defrostDefogStatus',
    latestValue([full], (p) =>
      p.is_front_defroster_on == null && p.is_rear_defroster_on == null
        ? null
        : p.is_front_defroster_on || p.is_rear_defroster_on
          ? 'on'
          : 'off',
    ),
  );
  set(
    'tirePressureFrontLeft',
    latestValue([full], (p) => p.tpms_pressure_fl),
  );
  set(
    'tirePressureFrontRight',
    latestValue([full], (p) => p.tpms_pressure_fr),
  );
  set(
    'tirePressureRearLeft',
    latestValue([full], (p) => p.tpms_pressure_rl),
  );
  set(
    'tirePressureRearRight',
    latestValue([full], (p) => p.tpms_pressure_rr),
  );
  if (snap.version) out.otaCurrentVersion = stamp(snap.version.at, snap.version.version);
  return out;
}

/** "2024.26.7 a1b2c3d4" → "2024.26.7": the build hash isn't useful on screen. */
export function softwareVersion(raw: string | null): string | null {
  const version = raw?.trim().split(/\s+/)[0];
  return version || null;
}

/**
 * A charge in progress as the live charging session the dashboard and
 * charging page show. TeslaMate doesn't log time remaining or the charge
 * limit, so those stay empty.
 */
export function liveChargingSession(
  snap: CarSnapshot,
  range: RangeKind,
  efficiencyKwhPerKm: number | null,
  now = Date.now(),
): LiveSessionData | null {
  const charging = snap.charging;
  if (!charging) return null;
  const { process, latest } = charging;
  const at = (latest?.date ?? process.start_date).toISOString();
  const rec = (value: string | number | null | undefined) =>
    value == null ? null : { value, updatedAt: at };
  const startRange =
    range === 'ideal' ? process.start_ideal_range_km : process.start_rated_range_km;
  const nowRange = rangeOf(latest, range);
  const power = latest?.charger_power ?? null;
  return {
    chargerId: null,
    currentCurrency: null,
    currentPrice: null,
    isFreeSession: null,
    isRivianCharger: false,
    locationId: null,
    startTime: process.start_date.toISOString(),
    timeElapsed: Math.max(0, Math.round((now - process.start_date.getTime()) / 1000)),
    power: rec(power),
    current: rec(latest?.charger_actual_current),
    soc: rec(latest?.battery_level ?? process.start_battery_level),
    totalChargedEnergy: rec(latest?.charge_energy_added),
    rangeAddedThisSession: rec(
      startRange != null && nowRange != null ? Math.max(0, nowRange - startRange) : null,
    ),
    // km of range per hour at this power, by the car's own efficiency.
    kilometersChargedPerHour: rec(
      power != null && power > 0 && efficiencyKwhPerKm ? power / efficiencyKwhPerKm : null,
    ),
    vehicleChargerState: rec(isCharging(latest) ? 'charging_active' : 'charging_ready'),
  };
}

/** A short address like Rivian's: "306 West Willow Street, Normal". */
export function shortAddress(a: AddressRow | null): string | null {
  if (!a) return null;
  const street = [a.house_number, a.road].filter(Boolean).join(' ');
  const head = a.name || street;
  if (!head) return a.display_name?.split(',')[0]?.trim() || null;
  return a.city && head !== a.city ? `${head}, ${a.city}` : head;
}

const isHomeName = (name: string | null) => name != null && /^\s*home\s*$/i.test(name);

export interface GeofenceRow {
  name: string;
  latitude: number;
  longitude: number;
  /** Metres. */
  radius: number;
}

/**
 * The geofence a point is in, nearest first. TeslaMate only names a drive's
 * geofences when it ends, so a drive under way looks its start up here.
 */
export function geofenceAt(
  lat: number | null,
  lon: number | null,
  geofences: readonly GeofenceRow[],
): string | null {
  if (lat == null || lon == null) return null;
  let best: { name: string; km: number } | null = null;
  for (const g of geofences) {
    const km = haversineKm(lat, lon, g.latitude, g.longitude);
    if (km * 1000 <= g.radius && (!best || km < best.km)) best = { name: g.name, km };
  }
  return best?.name ?? null;
}

/**
 * A saved location's name, as for a Rivian; else "Home" for a geofence named
 * Home or near a wallbox; else the geofence or address.
 */
export function drivePlace(
  geofence: string | null,
  address: AddressRow | null,
  lat: number | null,
  lon: number | null,
  places: Pick<Places, 'locations' | 'wallboxes'>,
): DrivePlaceDto | null {
  const full = address?.display_name ?? null;
  const home = isHomeName(geofence) || nearbySpot(lat, lon, places.wallboxes) != null;
  const location = nearbySpot(lat, lon, places.locations);
  if (location) {
    return {
      label: location.name,
      address: full,
      isHome: location.isHome || home,
      locationId: location.id,
      unnamed: false,
    };
  }
  if (home) return { label: 'Home', address: full, isHome: true, locationId: null, unnamed: false };
  const label = geofence || shortAddress(address);
  return label ? { label, address: full, isHome: false, locationId: null, unnamed: false } : null;
}

export interface DriveRow {
  id: number;
  started_at: Date;
  ended_at: Date | null;
  distance: number | null;
  start_km: number | null;
  speed_max: number | null;
  outside_temp_avg: number | null;
  ascent: number | null;
  descent: number | null;
  start_ideal_range_km: number | null;
  end_ideal_range_km: number | null;
  start_rated_range_km: number | null;
  end_rated_range_km: number | null;
  start_lat: number | null;
  start_lon: number | null;
  start_battery: number | null;
  end_lat: number | null;
  end_lon: number | null;
  end_battery: number | null;
  start_geofence: string | null;
  end_geofence: string | null;
  start_address: AddressRow | null;
  end_address: AddressRow | null;
}

/**
 * A drive under way: TeslaMate fills in a drive's summary when it ends, so
 * until then its figures come from the positions so far.
 */
export interface DriveProgress {
  first: PositionRow | null;
  latest: PositionRow | null;
  /** Latest position with battery and range readings. */
  latestFull: PositionRow | null;
  maxSpeed: number | null;
  /** Altitudes so far, for climb and descent. */
  altitudes?: number[];
}

/**
 * Energy as TeslaMate counts it: range used × the car's efficiency. Null
 * when it can't be worked out, and for drives that gained range.
 */
export function driveEnergyKwh(
  startRangeKm: number | null,
  endRangeKm: number | null,
  efficiencyKwhPerKm: number | null,
): number | null {
  if (startRangeKm == null || endRangeKm == null || !efficiencyKwhPerKm) return null;
  const kwh = (startRangeKm - endRangeKm) * efficiencyKwhPerKm;
  return kwh >= 0 ? kwh : null;
}

export function toDriveDto(
  row: DriveRow,
  opts: {
    range: RangeKind;
    efficiency: number | null;
    places: Pick<Places, 'locations' | 'wallboxes'>;
    progress?: DriveProgress | null;
    geofences?: readonly GeofenceRow[];
  },
): DriveDto {
  const live = row.ended_at == null ? (opts.progress ?? null) : null;
  const startPos = live?.first ?? null;
  const startLat = row.start_lat ?? startPos?.latitude ?? null;
  const startLon = row.start_lon ?? startPos?.longitude ?? null;
  // A drive's first position is a full report, so it carries the range.
  const startRange =
    (opts.range === 'ideal' ? row.start_ideal_range_km : row.start_rated_range_km) ??
    rangeOf(startPos, opts.range);
  const endRange = live
    ? rangeOf(live.latestFull, opts.range)
    : opts.range === 'ideal'
      ? row.end_ideal_range_km
      : row.end_rated_range_km;
  const startOdometer = row.start_km ?? startPos?.odometer ?? null;
  const distanceKm = live
    ? live.latest?.odometer != null && startOdometer != null
      ? Math.max(0, live.latest.odometer - startOdometer)
      : null
    : row.distance;
  const elevation = live?.altitudes ? elevationChange(live.altitudes) : null;
  return {
    id: row.id,
    startedAt: row.started_at.toISOString(),
    endedAt: row.ended_at?.toISOString() ?? null,
    startLat,
    startLon,
    endLat: live ? (live.latest?.latitude ?? null) : row.end_lat,
    endLon: live ? (live.latest?.longitude ?? null) : row.end_lon,
    distanceKm,
    startBattery: row.start_battery ?? startPos?.battery_level ?? null,
    endBattery: live ? (live.latestFull?.battery_level ?? null) : row.end_battery,
    energyKwh: driveEnergyKwh(startRange, endRange, opts.efficiency),
    elevationGainM: live ? (elevation?.gainM ?? null) : row.ascent,
    elevationLossM: live ? (elevation?.lossM ?? null) : row.descent,
    startRangeKm: startRange,
    endRangeKm: endRange,
    maxSpeedKmh: live ? live.maxSpeed : row.speed_max,
    // TeslaMate averages the car's own reading once the drive ends.
    outsideTempC: live ? null : row.outside_temp_avg,
    weather: null,
    driveMode: null,
    destination: null,
    start: drivePlace(
      row.start_geofence ?? (live ? geofenceAt(startLat, startLon, opts.geofences ?? []) : null),
      row.start_address,
      startLat,
      startLon,
      opts.places,
    ),
    end: live
      ? null
      : drivePlace(row.end_geofence, row.end_address, row.end_lat, row.end_lon, opts.places),
  };
}

export interface ChargingProcessRow {
  id: number;
  started_at: Date;
  ended_at: Date | null;
  charge_energy_added: number | null;
  /** Drawn from the charger, from its power over time; null when TeslaMate couldn't tell. */
  charge_energy_used: number | null;
  start_battery_level: number | null;
  end_battery_level: number | null;
  duration_min: number | null;
  start_ideal_range_km: number | null;
  end_ideal_range_km: number | null;
  start_rated_range_km: number | null;
  end_rated_range_km: number | null;
  cost: number | null;
  lat: number | null;
  lon: number | null;
  geofence: string | null;
  address: AddressRow | null;
  max_power: number | null;
  fast: boolean | null;
  brand: string | null;
  /** Latest charge reading, for a session still running. */
  latest_battery_level: number | null;
  latest_energy: number | null;
  latest_ideal_range_km: number | null;
  latest_rated_range_km: number | null;
}

export function toSessionDto(
  row: ChargingProcessRow,
  opts: {
    vehicleId: string;
    range: RangeKind;
    places: Places;
  },
): ChargingSessionDto {
  const running = row.ended_at == null;
  const pick = (ideal: number | null, rated: number | null) =>
    opts.range === 'ideal' ? ideal : rated;
  const startRange = pick(row.start_ideal_range_km, row.start_rated_range_km);
  const endRange = running
    ? pick(row.latest_ideal_range_km, row.latest_rated_range_km)
    : pick(row.end_ideal_range_km, row.end_rated_range_km);
  const energyKwh = running ? row.latest_energy : row.charge_energy_added;
  const hours = (row.duration_min ?? 0) / 60;
  // On DC the charger's power is measured at the battery, so what it drew
  // and what was added differ only by noise.
  const lossKwh =
    !running && row.fast !== true && row.charge_energy_used != null && energyKwh != null
      ? Math.max(0, row.charge_energy_used - energyKwh)
      : null;
  const supercharger = row.fast === true && /tesla/i.test(row.brand ?? '');
  // A geofence named Home counts as a home charger; DC fast charging never does.
  const at = sessionPlace(
    {
      isPublic: row.fast === true ? true : null,
      isHomeCharger: isHomeName(row.geofence) ? true : null,
      chargerType: null,
      lat: row.lat,
      lon: row.lon,
    },
    opts.places.locations,
    opts.places.wallboxes,
  );
  const { location, isHome } = at;
  const place =
    row.geofence ||
    (supercharger ? 'Tesla Supercharger' : null) ||
    shortAddress(row.address) ||
    (row.fast ? 'DC fast charger' : 'AC charger');
  const cost = row.cost != null ? row.cost.toFixed(2) : null;
  // Priced at its location's rate, as a Rivian's are; TeslaMate's own cost wins.
  const estimatedCost =
    cost == null ? estimateCost(energyKwh, sessionRate(at, opts.places.locations)) : null;
  return {
    id: row.id,
    vehicleId: opts.vehicleId,
    startedAt: row.started_at.toISOString(),
    endedAt: row.ended_at?.toISOString() ?? null,
    // chargerLabel() shows the charger id when there's no vendor.
    chargerId: place,
    chargerType: 'other',
    startSoc: row.start_battery_level,
    endSoc: running ? row.latest_battery_level : row.end_battery_level,
    chargingSeconds: running ? 0 : row.duration_min != null ? row.duration_min * 60 : null,
    chargingSince: running ? row.started_at.toISOString() : null,
    chargingStartedAt: row.started_at.toISOString(),
    chargingEndedAt: row.ended_at?.toISOString() ?? null,
    energyKwh,
    packKwh: null,
    thermalKwh: null,
    lossKwh,
    rangeAddedKm:
      startRange != null && endRange != null ? Math.max(0, endRange - startRange) : null,
    avgPowerKw: !running && energyKwh != null && hours > 0 ? energyKwh / hours : null,
    maxPowerKw: row.max_power,
    cost,
    // TeslaMate doesn't record a currency; costs are in the owner's own.
    currency: cost != null || estimatedCost != null ? opts.places.settings.currency : null,
    lat: row.lat,
    lon: row.lon,
    isHome,
    location: location && { id: location.id, name: location.name, isHome: location.isHome },
    estimatedCost,
    // TeslaMate records the energy added as it charges.
    estimatedEnergyKwh: null,
    // TeslaMate doesn't record the charge limit.
    socLimit: null,
    source: 'teslamate',
    vendor: null,
    city: row.address?.city ?? null,
    isPublic: row.fast === true ? true : null,
  };
}

export interface CapacityRow {
  at: Date;
  rated_battery_range_km: number | null;
  usable_battery_level: number | null;
}

/** Readings this close to empty make the estimate swing; TeslaMate's own panel has the same noise. */
const MIN_USABLE_LEVEL = 20;

/**
 * Usable capacity the way TeslaMate's Battery Health dashboard derives it:
 * rated range at the end of a charge × the car's efficiency, scaled up from
 * the usable battery level. "Rated" is the highest estimate seen, standing
 * in for the capacity when new.
 */
export function capacityHistory(rows: readonly CapacityRow[], efficiencyKwhPerKm: number | null) {
  const readings = efficiencyKwhPerKm
    ? rows
        .filter(
          (r) =>
            r.rated_battery_range_km != null &&
            r.usable_battery_level != null &&
            r.usable_battery_level >= MIN_USABLE_LEVEL,
        )
        .map((r) => ({
          at: r.at.toISOString(),
          kwh: (r.rated_battery_range_km! * efficiencyKwhPerKm) / (r.usable_battery_level! / 100),
        }))
    : [];
  const { latest, reported } = reportedCapacity(readings);
  const max = reported.reduce<(typeof reported)[number] | null>(
    (best, r) => (!best || r.kwh > best.kwh ? r : best),
    null,
  );
  return {
    latest,
    reported,
    ratedCapacity: max ? { kwh: max.kwh, at: max.at } : null,
  };
}

export type ActivityKind = StateSpanDto['state'];

/** What one TeslaMate table says the car was doing, and when. */
export interface ActivityInterval {
  kind: ActivityKind;
  from: Date;
  to: Date;
}

/** Where intervals overlap, the first of these wins. */
const ACTIVITY_PRIORITY: readonly ActivityKind[] = [
  'driving',
  'charging',
  'updating',
  'awake',
  'asleep',
];

/**
 * The car's activity across [from, to] from overlapping intervals: drives,
 * charges and updates over its online/asleep states. Time no interval
 * covers is left out, as unknown.
 */
export function activitySpans(
  intervals: readonly ActivityInterval[],
  from: Date,
  to: Date,
): StateSpanDto[] {
  const start = from.getTime();
  const end = to.getTime();
  const events: { at: number; rank: number; delta: 1 | -1 }[] = [];
  for (const i of intervals) {
    const a = Math.max(i.from.getTime(), start);
    const b = Math.min(i.to.getTime(), end);
    if (b <= a) continue;
    const rank = ACTIVITY_PRIORITY.indexOf(i.kind);
    events.push({ at: a, rank, delta: 1 }, { at: b, rank, delta: -1 });
  }
  events.sort((x, y) => x.at - y.at);
  const open = ACTIVITY_PRIORITY.map(() => 0);
  const spans: StateSpanDto[] = [];
  let k = 0;
  while (k < events.length) {
    const at = events[k]!.at;
    while (k < events.length && events[k]!.at === at) {
      open[events[k]!.rank]! += events[k]!.delta;
      k++;
    }
    const next = events[k]?.at;
    const rank = open.findIndex((n) => n > 0);
    if (next == null || rank < 0) continue;
    const state = ACTIVITY_PRIORITY[rank]!;
    const last = spans.at(-1);
    if (last && last.state === state && Date.parse(last.to) === at) {
      last.to = new Date(next).toISOString();
    } else {
      spans.push({ state, from: new Date(at).toISOString(), to: new Date(next).toISOString() });
    }
  }
  return spans;
}
