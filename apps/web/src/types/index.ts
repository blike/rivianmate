export type {
  AuthSession,
  ChargingSessionDetail,
  ChargingSessionSummary,
  DataQualityEvent,
  DataQualitySummary,
  DriveDetail,
  DriveSummary,
  OverviewSnapshot,
  RivianAuthStartResult,
  RivianCredentialStatus,
  RivianVehicleDiscoveryResult,
  SetupStatus,
  SnapshotHistoryPoint,
  VehicleHealthSnapshot,
  VehicleStateInterval,
  VehicleSummary,
} from "@rivianmate/shared";

export type Page =
  | "overview"
  | "drives"
  | "charging"
  | "battery"
  | "locations"
  | "health"
  | "data-quality"
  | "settings";

export interface UnitPrefs {
  distance: "mi" | "km";
  temperature: "f" | "c";
}

export interface AppData {
  setup: import("@rivianmate/shared").SetupStatus | null;
  auth: import("@rivianmate/shared").AuthSession | null;
  rivianCredentials: import("@rivianmate/shared").RivianCredentialStatus | null;
  overview: import("@rivianmate/shared").OverviewSnapshot | null;
  vehicles: import("@rivianmate/shared").VehicleSummary[];
  drives: import("@rivianmate/shared").DriveSummary[];
  charging: import("@rivianmate/shared").ChargingSessionSummary[];
  dataQuality: import("@rivianmate/shared").DataQualitySummary | null;
  history: import("@rivianmate/shared").SnapshotHistoryPoint[];
  loading: boolean;
  error: string | null;
}
