import type {
  BatteryHealthDto,
  BatteryWindowDto,
  ChargeSpanDto,
  ChargingCurvePointDto,
  ChargingSessionDto,
  ConnectResponse,
  ChargingCoverageDto,
  DriveCoverageDto,
  DriveDetailDto,
  DriveDto,
  DriverDto,
  FeedLatestData,
  FeedTopic,
  HistoryMetric,
  HistoryPoint,
  ImportBatchDto,
  ImportChargePreview,
  ImportDraftDto,
  ImportDrivePreview,
  ImportFormat,
  ImportPreviewDto,
  ImportSelection,
  ImportSessionAddition,
  ImportsDto,
  LocationPointDto,
  RivianDiagnosticsResponse,
  OrdersDto,
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
  TripActivityKind,
  TripActivityRef,
  TripAssignmentDto,
  TripCandidatesDto,
  TripDetailDto,
  TripDto,
  TripInput,
  TripRouteDto,
  TripSummaryDto,
} from '@server/api-types';

export type {
  TripActivityKind,
  TripActivityRef,
  TripAssignmentDto,
  TripDetailDto,
  TripDto,
  TripInput,
  TripRouteDto,
  TripSummaryDto,
  ImportBatchDto,
  ImportChargePreview,
  ImportDraftDto,
  ImportDrivePreview,
  ImportFormat,
  ImportPreviewDto,
  ImportSelection,
  ImportSessionAddition,
  ImportsDto,
  FeedLatestData,
  FeedTopic,
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
  DriverDto,
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

/**
 * A listing's window: everything since `from` (until `to`), or the page
 * started before `before`, or the page started after `after`.
 */
export type ListWindow = { from?: Date; to?: Date; before?: Date; after?: Date };

const listQuery = (q: ListWindow) => {
  const params = new URLSearchParams();
  if (q.from) params.set('from', q.from.toISOString());
  if (q.to) params.set('to', q.to.toISOString());
  if (q.before) params.set('before', q.before.toISOString());
  if (q.after) params.set('after', q.after.toISOString());
  const query = params.toString();
  return query ? `?${query}` : '';
};

const tripsPath = (vehicleId: string) => `/api/vehicles/${vehicleId}/trips`;

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
  orders: () => request<OrdersDto>('/api/orders'),
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
   * The newest drives; with `from` (and `to`), every drive that started in
   * that window; with `before`, the next page of those that started before
   * it; with `after`, the page of those that started after it (nearest it).
   */
  drives: (id: string, q: ListWindow = {}) =>
    request<DriveDto[]>(`/api/vehicles/${id}/drives${listQuery(q)}`),
  batteryWindow: (id: string, from: Date, to: Date) =>
    request<BatteryWindowDto>(
      `/api/vehicles/${id}/battery-window?from=${from.toISOString()}&to=${to.toISOString()}`,
    ),
  driveCoverage: (id: string) => request<DriveCoverageDto>(`/api/vehicles/${id}/drive-coverage`),
  chargingCoverage: (id: string) =>
    request<ChargingCoverageDto>(`/api/vehicles/${id}/charging-coverage`),
  drive: (vehicleId: string, driveId: number) =>
    request<DriveDetailDto>(`/api/vehicles/${vehicleId}/drives/${driveId}`),
  drivers: (vehicleId: string) => request<DriverDto[]>(`/api/vehicles/${vehicleId}/drivers`),
  /** Who drove, picked by hand; null for nobody. */
  setDriveDriver: (driveId: number, driverId: number | null) =>
    request<void>(`/api/drives/${driveId}/driver`, {
      method: 'PUT',
      body: JSON.stringify({ driverId }),
    }),
  trips: (vehicleId: string) => request<TripSummaryDto[]>(tripsPath(vehicleId)),
  trip: (vehicleId: string, tripId: number) =>
    request<TripDetailDto>(`${tripsPath(vehicleId)}/${tripId}`),
  tripRoute: (vehicleId: string, tripId: number) =>
    request<TripRouteDto[]>(`${tripsPath(vehicleId)}/${tripId}/route`),
  createTrip: (vehicleId: string, input: TripInput) =>
    request<TripDto>(tripsPath(vehicleId), { method: 'POST', body: JSON.stringify(input) }),
  updateTrip: (vehicleId: string, tripId: number, input: TripInput) =>
    request<TripDto>(`${tripsPath(vehicleId)}/${tripId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteTrip: (vehicleId: string, tripId: number) =>
    request<void>(`${tripsPath(vehicleId)}/${tripId}`, { method: 'DELETE' }),
  addTripActivities: (
    vehicleId: string,
    tripId: number,
    items: TripActivityRef[],
    move: boolean,
    exclude: TripActivityRef[] = [],
  ) =>
    request<void>(`${tripsPath(vehicleId)}/${tripId}/activities`, {
      method: 'POST',
      body: JSON.stringify({ items, move, exclude }),
    }),
  removeTripActivity: (vehicleId: string, tripId: number, kind: TripActivityKind, id: number) =>
    request<void>(`${tripsPath(vehicleId)}/${tripId}/activities/${kind}/${id}`, {
      method: 'DELETE',
    }),
  tripAssignments: (vehicleId: string) =>
    request<TripAssignmentDto[]>(`/api/vehicles/${vehicleId}/trip-assignments`),
  tripCandidates: (vehicleId: string, from: Date, to: Date, tripId?: number) =>
    request<TripCandidatesDto>(
      `/api/vehicles/${vehicleId}/trip-candidates?from=${from.toISOString()}&to=${to.toISOString()}${
        tripId != null ? `&tripId=${tripId}` : ''
      }`,
    ),
  /** As `drives`, for charging sessions. */
  chargingSessions: (id: string, q: ListWindow = {}) =>
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
  imports: () => request<ImportsDto>('/api/imports'),
  /** Sent as is, gzipped or not: the server works out which. */
  uploadImportFile: (file: File, draftId: string | undefined, format: ImportFormat) => {
    const params = new URLSearchParams({ name: file.name, format });
    if (draftId) params.set('draft', draftId);
    return request<ImportDraftDto>(`/api/imports/files?${params}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
    });
  },
  discardImportDraft: (id: string) =>
    request<void>(`/api/imports/drafts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  previewImport: (input: ImportSelection & { draftId: string }) =>
    request<ImportPreviewDto>('/api/imports/preview', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  startImport: (input: ImportSelection & { draftId: string }) =>
    request<ImportBatchDto>('/api/imports', { method: 'POST', body: JSON.stringify(input) }),
  undoImport: (id: number) => request<void>(`/api/imports/${id}`, { method: 'DELETE' }),
  teslamate: () => request<TeslaMateSettingsDto>('/api/settings/teslamate'),
  setTeslamate: (url: string) =>
    request<TeslaMateSettingsDto>('/api/settings/teslamate', {
      method: 'PUT',
      body: JSON.stringify({ url }),
    }),
  removeTeslamate: () =>
    request<TeslaMateSettingsDto>('/api/settings/teslamate', { method: 'DELETE' }),
};
