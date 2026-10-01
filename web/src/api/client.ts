import type {
  BatteryHealthDto,
  ChargingCurvePointDto,
  ChargingSessionDto,
  ConnectResponse,
  DriveDetailDto,
  DriveDto,
  HistoryMetric,
  HistoryPoint,
  LocationPointDto,
  RivianDiagnosticsResponse,
  OtaTimelineDto,
  PhantomDrainDto,
  SchedulesDto,
  StatusResponse,
  TirePressurePointDto,
  UnitPreferences,
  VehicleDto,
  VersionResponse,
  VehicleState,
  WallboxDto,
} from "@server/api-types.js";

export type {
  BatteryHealthDto,
  ChargingCurvePointDto,
  RivianDiagnosticsResponse,
  UnitPreferences,
  ChargingSessionDto,
  ConnectResponse,
  DriveDetailDto,
  DriveDto,
  HistoryMetric,
  HistoryPoint,
  LocationPointDto,
  StatusResponse,
  VehicleDto,
  VehicleState,
  WallboxDto,
};

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    credentials: "same-origin",
    ...init,
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // keep default message
    }
    throw new ApiError(message, response.status);
  }
  return (await response.json()) as T;
}

export const api = {
  status: () => request<StatusResponse>("/api/status"),
  setup: (password: string) =>
    request<{ ok: boolean }>("/api/setup", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  login: (password: string) =>
    request<{ ok: boolean }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean }>("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  rivianConnect: (email: string, password: string) =>
    request<ConnectResponse>("/api/rivian/connect", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  rivianOtp: (code: string) =>
    request<ConnectResponse>("/api/rivian/otp", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  version: () => request<VersionResponse>("/api/version"),
  units: () => request<UnitPreferences>("/api/settings/units"),
  setUnits: (units: UnitPreferences) =>
    request<UnitPreferences>("/api/settings/units", {
      method: "PUT",
      body: JSON.stringify(units),
    }),
  rivianDiagnostics: () =>
    request<RivianDiagnosticsResponse>("/api/rivian/diagnostics"),
  rivianDisconnect: () =>
    request<{ ok: boolean }>("/api/rivian/disconnect", { method: "POST" }),

  vehicles: () => request<VehicleDto[]>("/api/vehicles"),
  vehicleState: (id: string) => request<VehicleState>(`/api/vehicles/${id}/state`),
  history: (id: string, metric: HistoryMetric, from: Date, to: Date, bucket: string) =>
    request<HistoryPoint[]>(
      `/api/vehicles/${id}/history?metric=${metric}&from=${from.toISOString()}&to=${to.toISOString()}&bucket=${bucket}`,
    ),
  locations: (id: string, from: Date, to: Date) =>
    request<LocationPointDto[]>(
      `/api/vehicles/${id}/locations?from=${from.toISOString()}&to=${to.toISOString()}`,
    ),
  drives: (id: string) => request<DriveDto[]>(`/api/vehicles/${id}/drives`),
  drive: (driveId: number) => request<DriveDetailDto>(`/api/drives/${driveId}`),
  chargingSessions: (id: string) =>
    request<ChargingSessionDto[]>(`/api/vehicles/${id}/charging-sessions`),
  updateSessionCost: (sessionId: number, cost: string | null) =>
    request<ChargingSessionDto>(`/api/charging-sessions/${sessionId}`, {
      method: "PATCH",
      body: JSON.stringify({ cost }),
    }),
  wallboxes: () => request<WallboxDto[]>("/api/wallboxes"),
  phantomDrain: (vehicleId: string, days: number) =>
    request<PhantomDrainDto>(`/api/vehicles/${vehicleId}/health/phantom-drain?days=${days}`),
  schedules: (vehicleId: string) => request<SchedulesDto>(`/api/vehicles/${vehicleId}/schedules`),
  otaTimeline: (vehicleId: string) => request<OtaTimelineDto>(`/api/vehicles/${vehicleId}/ota`),
  tirePressures: (vehicleId: string, days: number) =>
    request<TirePressurePointDto[]>(`/api/vehicles/${vehicleId}/health/tires?days=${days}`),
  batteryHealth: (vehicleId: string) =>
    request<BatteryHealthDto>(`/api/vehicles/${vehicleId}/health/battery`),
  chargingCurve: (sessionId: number) =>
    request<ChargingCurvePointDto[]>(`/api/charging-sessions/${sessionId}/curve`),
};
