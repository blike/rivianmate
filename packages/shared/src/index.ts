export type CollectorStatus =
  | "not_configured"
  | "starting"
  | "healthy"
  | "degraded"
  | "reauth_required"
  | "rate_limited"
  | "offline";

export type VehiclePowerState =
  | "sleep"
  | "standby"
  | "ready"
  | "go"
  | "offline"
  | "unknown";

export interface VehicleSummary {
  id: string;
  vinSuffix: string | null;
  name: string;
  model: string | null;
  softwareVersion: string | null;
  enabled: boolean;
  lastSeenAt: string | null;
}

export interface OverviewSnapshot {
  vehicle: VehicleSummary | null;
  collectorStatus: CollectorStatus;
  batteryLevel: number | null;
  estimatedRangeKm: number | null;
  chargeLimit: number | null;
  powerState: VehiclePowerState;
  chargingState: string | null;
  latitude: number | null;
  longitude: number | null;
  cabinTemperatureC: number | null;
  outsideTemperatureC: number | null;
  speedMps: number | null;
  driveMode: string | null;
  lastUpdatedAt: string | null;
}

export interface SnapshotHistoryPoint {
  observedAt: string;
  batteryLevel: number | null;
  estimatedRangeKm: number | null;
  speedMps: number | null;
  latitude: number | null;
  longitude: number | null;
}

export interface DriveSummary {
  id: string;
  vehicleId: string;
  startDate: string;
  endDate: string | null;
  startLabel: string | null;
  endLabel: string | null;
  distanceKm: number | null;
  durationSeconds: number | null;
  startBatteryLevel: number | null;
  endBatteryLevel: number | null;
  confidence: "high" | "medium" | "low";
}

export interface ChargingSessionSummary {
  id: string;
  vehicleId: string;
  startDate: string;
  endDate: string | null;
  locationLabel: string | null;
  energyDeliveredKwh: number | null;
  rangeAddedKm: number | null;
  cost: number | null;
  currency: string | null;
  confidence: "high" | "medium" | "low";
}

export interface DataQualitySummary {
  collectorStatus: CollectorStatus;
  lastVehicleEventAt: string | null;
  lastChargingFetchAt: string | null;
  currentBackoffSeconds: number | null;
  rateLimitCount24h: number;
  parserErrorCount24h: number;
  rawEventCount24h: number;
}

export interface SetupStatus {
  adminConfigured: boolean;
}

export interface AuthSession {
  authenticated: boolean;
  username: string | null;
}

export interface RivianCredentialStatus {
  configured: boolean;
  email: string | null;
  status: CollectorStatus;
  mfaRequired: boolean;
}

export interface RivianAuthStartResult {
  status: "authenticated" | "mfa_required";
  challengeId?: string;
  discoveredVehicles?: number;
}

export interface RivianVehicleDiscoveryResult {
  vehicles: VehicleSummary[];
}

export interface DataQualityEvent {
  id: string;
  vehicleId: string | null;
  category: string;
  severity: string;
  message: string;
  observedAt: string;
}

export interface DriveDetail extends DriveSummary {
  startLatitude: number | null;
  startLongitude: number | null;
  endLatitude: number | null;
  endLongitude: number | null;
  positions: DrivePosition[];
}

export interface DrivePosition {
  observedAt: string;
  latitude: number;
  longitude: number;
  altitudeMeters: number | null;
  speedMps: number | null;
  batteryLevel: number | null;
}

export interface ChargingSessionDetail extends ChargingSessionSummary {
  startBatteryLevel: number | null;
  endBatteryLevel: number | null;
  peakPowerKw: number | null;
  samples: ChargingSample[];
}

export interface ChargingSample {
  observedAt: string;
  powerKw: number | null;
  totalChargedEnergyKwh: number | null;
  rangeAddedKm: number | null;
}

export interface VehicleStateInterval {
  id: string;
  vehicleId: string;
  state: string;
  startedAt: string;
  endedAt: string | null;
}

export interface VehicleHealthSnapshot {
  vehicleId: string;
  observedAt: string | null;
  tirePressureFrontLeft: string | null;
  tirePressureFrontRight: string | null;
  tirePressureRearLeft: string | null;
  tirePressureRearRight: string | null;
  twelveVoltBatteryHealth: string | null;
  otaCurrentVersion: string | null;
  otaAvailableVersion: string | null;
  otaInstallReady: boolean | null;
  otaInstallDuration: number | null;
}
