import type {
  LiveSessionData,
  SummaryUnitsMode,
  UnitPreferences,
  VehicleSummaryDto,
  VehicleSummaryStatus,
} from '../api-types.js';
import { closureStatuses } from '../closures.js';
import type { VehicleState } from '../rivian/types.js';
import { isChargingState } from './charging-time.js';
import { NAV_COVERS_MS, stateLocation, stateNumber, stateString } from './state-utils.js';

const METERS_PER_MILE = 1609.344;
const KM_PER_MILE = 1.609344;
const FEET_PER_METER = 3.28084;
const PSI_PER_BAR = 14.50377;

export interface SummaryVehicleMeta {
  id: string;
  vin: string;
  name: string | null;
  make: string | null;
  model: string | null;
  modelYear: number | null;
  source: 'rivian' | 'teslamate';
}

export function resolveSummaryUnits(
  mode: SummaryUnitsMode,
  userUnits: UnitPreferences,
): UnitPreferences {
  if (mode === 'imperial') return { distance: 'mi', temperature: 'F' };
  if (mode === 'metric') return { distance: 'km', temperature: 'C' };
  return userUnits;
}

function round(value: number | null, digits: number): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function classifyStatus(
  state: VehicleState,
  speedMps: number | null,
  charging: boolean,
  pluggedIn: boolean,
): { status: VehicleSummaryStatus; statusLabel: string } {
  const gear = stateString(state, 'gearStatus');
  const power = stateString(state, 'powerState');
  if (gear === 'drive' || gear === 'reverse' || (power === 'go' && (speedMps ?? 0) > 1)) {
    return { status: 'driving', statusLabel: 'Driving' };
  }
  if (charging) return { status: 'charging', statusLabel: 'Charging' };
  if (pluggedIn) return { status: 'plugged', statusLabel: 'Plugged in' };
  if (power === 'sleep') return { status: 'asleep', statusLabel: 'Asleep' };
  return { status: 'parked', statusLabel: 'Parked' };
}

function currentSpeedMps(state: VehicleState): number | null {
  const gnss = stateNumber(state, 'gnssSpeed');
  if (gnss != null) return gnss;
  // Avoid surfacing a stale navigation speed from an earlier drive while parked.
  if (stateString(state, 'gearStatus') === 'park') return null;
  const nav = state.navLocation;
  if (nav?.speedMps == null) return null;
  const navAt = Date.parse(nav.timeStamp);
  const gnssAt = state.gnssLocation ? Date.parse(state.gnssLocation.timeStamp) : Number.NaN;
  if (Number.isFinite(navAt) && Number.isFinite(gnssAt) && gnssAt - navAt > NAV_COVERS_MS) {
    return null;
  }
  return nav.speedMps;
}

function liveNumber(record: { value: string | number | null } | null | undefined): number | null {
  if (record?.value == null) return null;
  const n = Number(record.value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Builds a flat, unit-converted summary from raw `VehicleState` and optional
 * live charging data. Keeps conversions consistent with the web dashboard.
 */
export function buildVehicleSummary(
  vehicle: SummaryVehicleMeta,
  state: VehicleState,
  prefs: UnitPreferences,
  liveCharging: LiveSessionData | null = null,
): VehicleSummaryDto {
  const imperialDist = prefs.distance === 'mi';
  const fahrenheit = prefs.temperature === 'F';

  const convertKm = (km: number | null) =>
    km == null ? null : round(imperialDist ? km / KM_PER_MILE : km, 1);
  const convertMetersToDist = (m: number | null) =>
    m == null ? null : round(imperialDist ? m / METERS_PER_MILE : m / 1000, 1);
  const convertSpeedMps = (mps: number | null) =>
    mps == null ? null : round(imperialDist ? (mps * 3600) / METERS_PER_MILE : mps * 3.6, 1);
  const convertAltitudeM = (m: number | null) =>
    m == null ? null : round(imperialDist ? m * FEET_PER_METER : m, 0);
  const convertTempC = (c: number | null) =>
    c == null ? null : round(fahrenheit ? (c * 9) / 5 + 32 : c, 1);
  const convertPressureBar = (bar: number | null) =>
    bar == null ? null : round(imperialDist ? bar * PSI_PER_BAR : bar, imperialDist ? 1 : 2);

  const speedMps = currentSpeedMps(state);
  const chargerStatus = stateString(state, 'chargerStatus');
  const chargerState = stateString(state, 'chargerState');
  const liveChargerState =
    liveCharging?.vehicleChargerState?.value == null
      ? null
      : String(liveCharging.vehicleChargerState.value);

  const charging =
    chargerStatus === 'chrgr_sts_connected_charging' ||
    isChargingState(chargerState) ||
    isChargingState(liveChargerState);
  const pluggedIn = charging || (chargerStatus?.startsWith('chrgr_sts_connected') ?? false);
  const { status, statusLabel } = classifyStatus(state, speedMps, charging, pluggedIn);

  const liveSecondsLeft = charging ? liveNumber(liveCharging?.timeRemaining) : null;
  const rawTimeLeft =
    liveSecondsLeft != null && liveSecondsLeft > 0
      ? liveSecondsLeft / 60
      : stateNumber(state, 'timeToEndOfCharge');
  const timeToEndOfChargeMin =
    charging && rawTimeLeft != null && rawTimeLeft > 0 ? Math.round(rawTimeLeft) : null;

  const livePowerNum = charging ? liveNumber(liveCharging?.power) : null;
  const chargingPowerKw = livePowerNum != null ? round(livePowerNum, 1) : null;

  const batteryLevel = round(
    (charging ? liveNumber(liveCharging?.soc) : null) ?? stateNumber(state, 'batteryLevel'),
    1,
  );
  const batteryLimit = round(
    (charging ? liveNumber(liveCharging?.socLimit) : null) ?? stateNumber(state, 'batteryLimit'),
    0,
  );
  const batteryCapacityKwh = round(
    (charging ? liveNumber(liveCharging?.batteryCapacityKwh) : null) ??
      stateNumber(state, 'batteryCapacity'),
    1,
  );

  const { closures, windows } = closureStatuses(state, vehicle.model);
  const locks = closures.map((c) => c.locked).filter((l): l is boolean => l !== null);
  const locked = locks.length === 0 ? null : locks.every(Boolean);
  const openClosures = [...closures, ...windows].filter((c) => !c.closed).map((c) => c.label);

  const currentVersion = stateString(state, 'otaCurrentVersion');
  const availableRaw = stateString(state, 'otaAvailableVersion');
  const updateAvailable =
    availableRaw && availableRaw !== '0.0.0' && availableRaw !== currentVersion
      ? availableRaw
      : null;

  const fix = stateLocation(state);

  return {
    id: vehicle.id,
    vin: vehicle.vin,
    name: vehicle.name,
    make: vehicle.make,
    model: vehicle.model,
    modelYear: vehicle.modelYear,
    source: vehicle.source,
    status,
    statusLabel,
    online: state.cloudConnection?.isOnline ?? null,
    lastSync: state.cloudConnection?.lastSync ?? null,
    batteryLevel,
    batteryLimit,
    batteryCapacityKwh,
    batteryTemp: convertTempC(stateNumber(state, 'batteryTempAvg')),
    range: convertKm(stateNumber(state, 'distanceToEmpty')),
    odometer: convertMetersToDist(stateNumber(state, 'vehicleMileage')),
    speed: convertSpeedMps(speedMps),
    altitude: convertAltitudeM(stateNumber(state, 'gnssAltitude')),
    gear: stateString(state, 'gearStatus'),
    driveMode: stateString(state, 'driveMode'),
    powerState: stateString(state, 'powerState'),
    pluggedIn,
    charging,
    chargerState: chargerState ?? liveChargerState,
    timeToEndOfChargeMin,
    chargingPowerKw,
    cabinTemp: convertTempC(stateNumber(state, 'cabinClimateInteriorTemperature')),
    targetTemp: convertTempC(stateNumber(state, 'cabinClimateDriverTemperature')),
    tirePressures: {
      frontLeft: convertPressureBar(stateNumber(state, 'tirePressureFrontLeft')),
      frontRight: convertPressureBar(stateNumber(state, 'tirePressureFrontRight')),
      rearLeft: convertPressureBar(stateNumber(state, 'tirePressureRearLeft')),
      rearRight: convertPressureBar(stateNumber(state, 'tirePressureRearRight')),
    },
    locked,
    openClosures,
    softwareVersion: currentVersion && currentVersion !== '0.0.0' ? currentVersion : null,
    updateAvailable,
    location: fix ? { lat: fix.latitude, lon: fix.longitude, ts: fix.timeStamp } : null,
    units: {
      distance: prefs.distance,
      speed: imperialDist ? 'mph' : 'km/h',
      temperature: prefs.temperature,
      pressure: imperialDist ? 'psi' : 'bar',
      elevation: imperialDist ? 'ft' : 'm',
    },
  };
}
