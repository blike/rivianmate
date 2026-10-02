/**
 * REST API response shapes. The web app imports these types (types only —
 * erased at compile time) so both sides stay in sync.
 */
import type { RivianTrafficSnapshot } from "./rivian/governor.js";
import type {
  ChargingSchedule,
  DepartureSchedule,
  LiveSessionData,
  VehicleState,
} from "./rivian/types.js";
import type { MonitorDiagnostics } from "./services/vehicle-monitor.js";

export type { ChargingSchedule, DepartureSchedule, LiveSessionData, VehicleState };

export interface SchedulesDto {
  /** null when not fetched yet or Rivian didn't provide it. */
  charging: ChargingSchedule[] | null;
  departures: DepartureSchedule[] | null;
  departuresUnavailable: boolean;
  chargingUpdatedAt: string | null;
  departuresUpdatedAt: string | null;
}

export interface StatusResponse {
  needsSetup: boolean;
  authed: boolean;
  rivianConnected: boolean;
  rivianAuthState: "ok" | "unauthenticated" | null;
  rivianEmail: string | null;
  mockMode: boolean;
}

export interface VersionResponse {
  /** Package version, e.g. "0.3.0". */
  version: string | null;
  /** Full git commit SHA the image was built from; null outside Docker builds. */
  commit: string | null;
}

export interface VehicleDto {
  id: string;
  vin: string;
  name: string | null;
  make: string | null;
  model: string | null;
  modelYear: number | null;
}

export type { HomeChargingSettings } from "./services/home-charging.js";

/** Map basemap overrides from the server environment; null = app defaults. */
export interface MapConfigResponse {
  styleUrl: string | null;
  tilesUrl: string | null;
  glyphsUrl: string | null;
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

/**
 * While a drive is in progress (endedAt null), the end figures (distance,
 * end battery and range, energy) are its readings so far.
 */
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
  /** Vehicle's range estimate at the start and end (now, while in progress). */
  startRangeKm: number | null;
  endRangeKm: number | null;
  maxSpeedKmh: number | null;
  driveMode: string | null;
  /** Where navigation was headed, if the vehicle was navigating. */
  destination: { name: string | null; lat: number; lon: number } | null;
  /** Where it started and ended: "Home", or an address once looked up. */
  start: DrivePlaceDto | null;
  end: DrivePlaceDto | null;
}

export interface DrivePlaceDto {
  /** "Home" or a short address, e.g. "306 West Willow Street, Normal". */
  label: string;
  /** Full address, when looked up. */
  address: string | null;
  isHome: boolean;
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
  /**
   * startedAt → endedAt spans the plug-in. Within it, seconds spent charging
   * (null when unknown), not counting a stretch running since `chargingSince`.
   */
  chargingSeconds: number | null;
  chargingSince: string | null;
  energyKwh: number | null;
  /** Rivian's split of the energy: stored in the pack vs heating/cooling it. */
  packKwh: number | null;
  thermalKwh: number | null;
  rangeAddedKm: number | null;
  avgPowerKw: number | null;
  maxPowerKw: number | null;
  cost: string | null;
  currency: string | null;
  lat: number | null;
  lon: number | null;
  /** Charged at home (Rivian's flag, home wallbox, or near home). */
  isHome: boolean;
  /** Energy × home rate, when this home session has no cost of its own. */
  estimatedCost: string | null;
  /** live = recorded by RivianMate; rivian = imported from Rivian's history. */
  source: "live" | "rivian" | "live+rivian";
  vendor: string | null;
  city: string | null;
  isPublic: boolean | null;
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

/**
 * Latest readings from Rivian's Parallax feed; each part is null until the
 * vehicle has reported it. `at` is when Rivian sent it.
 */
export interface VehicleInsightsDto {
  /** Last cell temperatures reported (°C); only sent while awake. */
  cellTemps: { avgC: number; maxC: number; minC: number; at: string } | null;
  /** Whether the latest battery report carried temperatures (vehicle awake). */
  cellTempsCurrent: boolean;
  coldWeather: { usableSoc: number | null; coldSoc: number; rangeImpactKm: number; at: string } | null;
  /** Energy used while parked, over Rivian's windows (e.g. last 24 h). */
  parkedEnergy: {
    windows: {
      minutes: number;
      kwh: number;
      rangeKm: number;
      uses: { climate: number; system: number; gearGuardAndOutlets: number };
    }[];
    at: string;
  } | null;
  /** The vehicle's active navigation; null when it isn't navigating. */
  navigation: {
    destination: { name: string | null; lat: number; lon: number };
    totalDistanceKm: number | null;
    totalDurationS: number | null;
    arrivalSoc: number | null;
    arrivalRangeKm: number | null;
    etaAt: string | null;
    remainingKm: number | null;
    remainingS: number | null;
    at: string;
  } | null;
  connectivity: {
    wifi: { ssid: string; rssiDbm: number | null; frequencyMhz: number | null } | null;
    cellular: { carrier: string | null; technology: string | null } | null;
    at: string;
  } | null;
}
