/**
 * REST API response shapes. The web app imports these types (types only —
 * erased at compile time) so both sides stay in sync.
 */
import type { RivianTrafficSnapshot } from "./rivian/governor.js";
import type { LiveSessionData, VehicleState } from "./rivian/types.js";
import type { MonitorDiagnostics } from "./services/vehicle-monitor.js";

export type { LiveSessionData, VehicleState };

export interface StatusResponse {
  needsSetup: boolean;
  authed: boolean;
  rivianConnected: boolean;
  rivianAuthState: "ok" | "unauthenticated" | null;
  rivianEmail: string | null;
  mockMode: boolean;
}

export interface VehicleDto {
  id: string;
  vin: string;
  name: string | null;
  make: string | null;
  model: string | null;
  modelYear: number | null;
}

export interface UnitPreferences {
  distance: "mi" | "km";
  temperature: "F" | "C";
}

export interface RivianDiagnosticsResponse {
  monitor: MonitorDiagnostics;
  traffic: RivianTrafficSnapshot;
}

export interface ConnectResponse {
  ok: boolean;
  otpRequired?: boolean;
}

export interface HistoryPoint {
  bucket: string;
  avg: number | null;
  min: number | null;
  max: number | null;
}

export type HistoryMetric = "battery" | "range" | "mileage" | "cabinTemp";

export interface LocationPointDto {
  ts: string;
  lat: number;
  lon: number;
  speedKmh: number | null;
  bearing: number | null;
  altitude: number | null;
}

export interface DriveDto {
  id: number;
  startedAt: string;
  endedAt: string | null;
  startLat: number | null;
  startLon: number | null;
  endLat: number | null;
  endLon: number | null;
  distanceKm: number | null;
  startBattery: number | null;
  endBattery: number | null;
  /** Battery-% drop × reported pack capacity; null when not computable. */
  energyKwh: number | null;
  elevationGainM: number | null;
  elevationLossM: number | null;
}

export interface DriveDetailDto extends DriveDto {
  points: LocationPointDto[];
}

export interface OtaTimelineDto {
  current: string | null;
  available: string | null;
  availableNotesUrl: string | null;
  /** Installed versions, newest first; firstSeen is when RivianMate first saw it. */
  versions: { version: string; firstSeen: string; notesUrl: string | null }[];
}

/** Average tire pressures per time bucket, in bar. */
export interface TirePressurePointDto {
  ts: string;
  frontLeft: number | null;
  frontRight: number | null;
  rearLeft: number | null;
  rearRight: number | null;
}

export interface PhantomDrainDto {
  days: { day: string; lossPct: number; parkedHours: number; pctPerDay: number }[];
  /** Average %/day over all parked time in the window; null if too little data. */
  avgPctPerDay: number | null;
}

export interface BatteryHealthDto {
  /** Usable-capacity estimates from charging sessions (energy ÷ SoC gained). */
  estimates: { sessionId: number; date: string; socGain: number; estimatedKwh: number }[];
  /** Pack capacity as reported by the vehicle, max per day. */
  reported: { day: string; kwh: number }[];
  cellType: string | null;
}

export interface ChargingCurvePointDto {
  ts: string;
  powerKw: number | null;
  soc: number | null;
}

export interface ChargingSessionDto {
  id: number;
  vehicleId: string;
  startedAt: string;
  endedAt: string | null;
  chargerId: string | null;
  chargerType: string | null;
  startSoc: number | null;
  endSoc: number | null;
  energyKwh: number | null;
  rangeAddedKm: number | null;
  avgPowerKw: number | null;
  maxPowerKw: number | null;
  cost: string | null;
  currency: string | null;
  lat: number | null;
  lon: number | null;
}

export interface WallboxDto {
  wallboxId: string;
  name: string | null;
  model: string | null;
  serialNumber: string | null;
  softwareVersion: string | null;
  maxAmps: number | null;
  maxPower: number | null;
  latitude: number | null;
  longitude: number | null;
  latest: {
    ts: string;
    chargingStatus: string | null;
    power: number | null;
    currentVoltage: number | null;
    currentAmps: number | null;
  } | null;
}
