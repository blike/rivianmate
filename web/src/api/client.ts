import type {
  BatteryHealthDto,
  BatteryWindowDto,
  ChargeSpanDto,
  ChargingCurvePointDto,
  ChargingSessionDto,
  ConnectResponse,
  DriveCoverageDto,
  DriveDetailDto,
  DriveDto,
  FeedLatestData,
  HistoryMetric,
  HistoryPoint,
  LocationPointDto,
  RivianDiagnosticsResponse,
  OtaTimelineDto,
  PhantomDrainDto,
  SchedulesDto,
  StateSpanDto,
  StatusResponse,
  TirePressurePointDto,
  TireRotationDto,
  LookupSettings,
  UnitPreferences,
  VehicleDto,
  VehicleInsightsDto,
  VersionResponse,
  VehicleState,
  WallboxDto,
  ChargingSettings,
  GeocodeResultDto,
  SavedLocation,
  SavedLocationInput,
  NotificationSettingsDto,
  NotificationSettingsUpdate,
  NotificationTestResult,
  TeslaMateSettingsDto,
} from '@server/api-types';

export type {
  FeedLatestData,
  TeslaMateSettingsDto,
  ChargingSettings,
  GeocodeResultDto,
  SavedLocation,
  SavedLocationInput,
  BatteryHealthDto,
  ChargingCurvePointDto,
  RivianDiagnosticsResponse,
  LookupSettings,
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
  VehicleInsightsDto,
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
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    credentials: 'same-origin',
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
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** A listing's window: everything since `from`, or the page started before `before`. */
const listQuery = (q: { from?: Date; before?: Date }) => {
  const params = new URLSearchParams();
  if (q.from) params.set('from', q.from.toISOString());
  if (q.before) params.set('before', q.before.toISOString());
  const query = params.toString();
  return query ? `?${query}` : '';
};

export const api = {
  status: () => request<StatusResponse>('/api/status'),
  setup: (password: string) =>
    request<{ ok: boolean }>('/api/setup', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  login: (password: string) =>
    request<{ ok: boolean }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  rivianConnect: (email: string, password: string) =>
    request<ConnectResponse>('/api/rivian/connect', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  rivianOtp: (code: string) =>
    request<ConnectResponse>('/api/rivian/otp', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  version: () => request<VersionResponse>('/api/version'),
  chargingSettings: () => request<ChargingSettings>('/api/settings/charging'),
  setChargingSettings: (settings: ChargingSettings) =>
    request<ChargingSettings>('/api/settings/charging', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),
  savedLocations: () => request<SavedLocation[]>('/api/locations'),
  createLocation: (location: SavedLocationInput) =>
    request<SavedLocation>('/api/locations', {
      method: 'POST',
      body: JSON.stringify(location),
    }),
  updateLocation: (id: number, location: SavedLocationInput) =>
    request<SavedLocation>(`/api/locations/${id}`, {
      method: 'PUT',
      body: JSON.stringify(location),
    }),
  deleteLocation: (id: number) => request<void>(`/api/locations/${id}`, { method: 'DELETE' }),
  searchPlaces: (q: string, near: { lat: number; lon: number }, signal?: AbortSignal) =>
    request<GeocodeResultDto[]>(
      `/api/geocode/search?${new URLSearchParams({ q, lat: String(near.lat), lon: String(near.lon) })}`,
      { signal },
    ),
  notificationSettings: () => request<NotificationSettingsDto>('/api/settings/notifications'),
  setNotificationSettings: (settings: NotificationSettingsUpdate) =>
    request<NotificationSettingsDto>('/api/settings/notifications', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),
  testNotifications: () =>
    request<NotificationTestResult[]>('/api/settings/notifications/test', { method: 'POST' }),
  lookups: () => request<LookupSettings>('/api/settings/lookups'),
  setLookups: (lookups: LookupSettings) =>
    request<LookupSettings>('/api/settings/lookups', {
      method: 'PUT',
      body: JSON.stringify(lookups),
    }),
  units: () => request<UnitPreferences>('/api/settings/units'),
  setUnits: (units: UnitPreferences) =>
    request<UnitPreferences>('/api/settings/units', {
      method: 'PUT',
      body: JSON.stringify(units),
    }),
  rivianDiagnostics: () => request<RivianDiagnosticsResponse>('/api/rivian/diagnostics'),
  feedLatest: (feedId: string) =>
    request<FeedLatestData>(`/api/rivian/feeds/${encodeURIComponent(feedId)}/latest`),
  rivianDisconnect: () => request<{ ok: boolean }>('/api/rivian/disconnect', { method: 'POST' }),

  vehicles: () => request<VehicleDto[]>('/api/vehicles'),
  vehicleState: (id: string) => request<VehicleState>(`/api/vehicles/${id}/state`),
  history: (id: string, metric: HistoryMetric, from: Date, to: Date, bucket: string) =>
    request<HistoryPoint[]>(
      `/api/vehicles/${id}/history?metric=${metric}&from=${from.toISOString()}&to=${to.toISOString()}&bucket=${bucket}`,
    ),
  chargeSpans: (id: string, from: Date, to: Date) =>
    request<ChargeSpanDto[]>(
      `/api/vehicles/${id}/charge-spans?from=${from.toISOString()}&to=${to.toISOString()}`,
    ),
  stateSpans: (id: string, from: Date, to: Date) =>
    request<StateSpanDto[]>(
      `/api/vehicles/${id}/state-spans?from=${from.toISOString()}&to=${to.toISOString()}`,
    ),
  locations: (id: string, from: Date, to: Date) =>
    request<LocationPointDto[]>(
      `/api/vehicles/${id}/locations?from=${from.toISOString()}&to=${to.toISOString()}`,
    ),
  /**
   * The newest drives; with `from`, every drive that started after it; with
   * `before`, the next page of those that started before it.
   */
  drives: (id: string, q: { from?: Date; before?: Date } = {}) =>
    request<DriveDto[]>(`/api/vehicles/${id}/drives${listQuery(q)}`),
  batteryWindow: (id: string, from: Date, to: Date) =>
    request<BatteryWindowDto>(
      `/api/vehicles/${id}/battery-window?from=${from.toISOString()}&to=${to.toISOString()}`,
    ),
  driveCoverage: (id: string) => request<DriveCoverageDto>(`/api/vehicles/${id}/drive-coverage`),
  drive: (vehicleId: string, driveId: number) =>
    request<DriveDetailDto>(`/api/vehicles/${vehicleId}/drives/${driveId}`),
  /** As `drives`, for charging sessions. */
  chargingSessions: (id: string, q: { from?: Date; before?: Date } = {}) =>
    request<ChargingSessionDto[]>(`/api/vehicles/${id}/charging-sessions${listQuery(q)}`),
  updateSessionCost: (sessionId: number, cost: string | null) =>
    request<ChargingSessionDto>(`/api/charging-sessions/${sessionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ cost }),
    }),
  wallboxes: () => request<WallboxDto[]>('/api/wallboxes'),
  phantomDrain: (vehicleId: string, days: number) =>
    request<PhantomDrainDto>(
      `/api/vehicles/${vehicleId}/health/phantom-drain?days=${days}&tz=${encodeURIComponent(
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      )}`,
    ),
  insights: (vehicleId: string) =>
    request<VehicleInsightsDto>(`/api/vehicles/${vehicleId}/insights`),
  schedules: (vehicleId: string) => request<SchedulesDto>(`/api/vehicles/${vehicleId}/schedules`),
  otaTimeline: (vehicleId: string) => request<OtaTimelineDto>(`/api/vehicles/${vehicleId}/ota`),
  tirePressures: (vehicleId: string, days: number) =>
    request<TirePressurePointDto[]>(`/api/vehicles/${vehicleId}/health/tires?days=${days}`),
  tireRotation: (vehicleId: string) =>
    request<TireRotationDto | null>(`/api/vehicles/${vehicleId}/health/tire-rotation`),
  batteryHealth: (vehicleId: string) =>
    request<BatteryHealthDto>(`/api/vehicles/${vehicleId}/health/battery`),
  chargingCurve: (vehicleId: string, sessionId: number) =>
    request<ChargingCurvePointDto[]>(
      `/api/vehicles/${vehicleId}/charging-sessions/${sessionId}/curve`,
    ),
  teslamate: () => request<TeslaMateSettingsDto>('/api/settings/teslamate'),
  setTeslamate: (url: string) =>
    request<TeslaMateSettingsDto>('/api/settings/teslamate', {
      method: 'PUT',
      body: JSON.stringify({ url }),
    }),
  removeTeslamate: () =>
    request<TeslaMateSettingsDto>('/api/settings/teslamate', { method: 'DELETE' }),
};
