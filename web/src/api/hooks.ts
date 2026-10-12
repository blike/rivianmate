import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import type { LiveSessionData, NotificationSettingsUpdate, VehicleState } from '@server/api-types';
import { DEFAULT_UNITS, unitFormatter } from '../lib/units';
import {
  api,
  type ChargingSettings,
  type SavedLocation,
  type SavedLocationInput,
  type UnitPreferences,
} from './client';

export function useStatus() {
  return useQuery({ queryKey: ['status'], queryFn: api.status, staleTime: 5000 });
}

export function useVehicles(enabled = true) {
  return useQuery({ queryKey: ['vehicles'], queryFn: api.vehicles, enabled });
}

export function useVehicleState(vehicleId: string | undefined) {
  return useQuery({
    queryKey: ['vehicleState', vehicleId],
    queryFn: () => api.vehicleState(vehicleId!),
    enabled: !!vehicleId,
    staleTime: Infinity,
    retry: 1,
  });
}

/**
 * Opens the SSE stream and writes updates into the query cache so every
 * component reading ['vehicleState', id] re-renders live.
 */
export function useLiveState(vehicleId: string | undefined) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!vehicleId) return;
    const source = new EventSource(`/api/vehicles/${vehicleId}/live`);
    source.addEventListener('state', (event) => {
      const state = JSON.parse((event as MessageEvent).data) as VehicleState;
      queryClient.setQueryData(['vehicleState', vehicleId], state);
    });
    source.addEventListener('charging', (event) => {
      const session = JSON.parse((event as MessageEvent).data) as LiveSessionData | null;
      queryClient.setQueryData(['liveCharging', vehicleId], session);
    });
    return () => source.close();
  }, [vehicleId, queryClient]);
}

export function useLiveCharging(vehicleId: string | undefined) {
  return useQuery<LiveSessionData | null>({
    queryKey: ['liveCharging', vehicleId],
    queryFn: () => null,
    enabled: false,
    staleTime: Infinity,
  });
}

/** Anything still under way (a drive, navigation) refreshes this often. */
const LIVE_REFRESH_MS = 15_000;

export function useDrives(vehicleId: string) {
  return useQuery({
    queryKey: ['drives', vehicleId],
    queryFn: () => api.drives(vehicleId),
    // A drive in progress grows by the second.
    refetchInterval: (query) =>
      query.state.data?.some((d) => !d.endedAt) ? LIVE_REFRESH_MS : 60_000,
  });
}

export function useDrive(driveId: number | null) {
  return useQuery({
    queryKey: ['drive', driveId],
    queryFn: () => api.drive(driveId!),
    enabled: driveId != null,
    refetchInterval: (query) =>
      query.state.data && !query.state.data.endedAt ? LIVE_REFRESH_MS : false,
    // Keep the previous drive on screen while the next one loads.
    placeholderData: keepPreviousData,
  });
}

export function useChargingSessions(vehicleId: string) {
  return useQuery({
    queryKey: ['chargingSessions', vehicleId],
    queryFn: () => api.chargingSessions(vehicleId),
    refetchInterval: 60_000,
  });
}

export function useInsights(vehicleId: string) {
  return useQuery({
    queryKey: ['insights', vehicleId],
    queryFn: () => api.insights(vehicleId),
    // Navigation progress changes by the second; other readings slowly.
    refetchInterval: (query) => (query.state.data?.navigation ? LIVE_REFRESH_MS : 60_000),
  });
}

export function useUnitPreferences() {
  return useQuery({ queryKey: ['units'], queryFn: api.units, staleTime: Infinity });
}

/** App-wide unit preferences plus ready-made formatters. */
export function useUnits() {
  const { data } = useUnitPreferences();
  const units = data ?? DEFAULT_UNITS;
  // Stable identity per unit choice so consumers can use it as a dependency.
  return useMemo(
    () => unitFormatter({ distance: units.distance, temperature: units.temperature }),
    [units.distance, units.temperature],
  );
}

export function useSetUnits() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (units: UnitPreferences) => api.setUnits(units),
    onMutate: (units) => queryClient.setQueryData(['units'], units),
    onSuccess: (units) => queryClient.setQueryData(['units'], units),
    onError: () => queryClient.invalidateQueries({ queryKey: ['units'] }),
  });
}

export function useChargingSettings() {
  return useQuery({
    queryKey: ['chargingSettings'],
    queryFn: api.chargingSettings,
    staleTime: Infinity,
  });
}

export function useSetChargingSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: ChargingSettings) => api.setChargingSettings(settings),
    onSuccess: (settings) => {
      queryClient.setQueryData(['chargingSettings'], settings);
      // Estimated costs are shown in this currency.
      void queryClient.invalidateQueries({ queryKey: ['chargingSessions'] });
    },
  });
}

export function useLocations() {
  return useQuery({
    queryKey: ['savedLocations'],
    queryFn: api.savedLocations,
    staleTime: Infinity,
  });
}

/** Saves (with an id) or adds a location, or deletes one. */
export function useSaveLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (
      change:
        | { kind: 'save'; id: number | null; location: SavedLocationInput }
        | { kind: 'delete'; id: number },
    ): Promise<SavedLocation | void> =>
      change.kind === 'delete'
        ? api.deleteLocation(change.id)
        : change.id == null
          ? api.createLocation(change.location)
          : api.updateLocation(change.id, change.location),
    onSuccess: () => {
      // Session prices and drive and session names come from locations.
      for (const key of ['savedLocations', 'chargingSessions', 'drives', 'drive'])
        void queryClient.invalidateQueries({ queryKey: [key] });
    },
  });
}

export function useNotificationSettings() {
  return useQuery({ queryKey: ['notificationSettings'], queryFn: api.notificationSettings });
}

export function useSetNotificationSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: NotificationSettingsUpdate) => api.setNotificationSettings(settings),
    onSuccess: (settings) => queryClient.setQueryData(['notificationSettings'], settings),
  });
}

export function useTestNotifications() {
  return useMutation({ mutationFn: api.testNotifications });
}

export function useVersion() {
  return useQuery({ queryKey: ['version'], queryFn: api.version, staleTime: Infinity });
}

export function useRivianDiagnostics(live = true) {
  return useQuery({
    queryKey: ['rivianDiagnostics'],
    queryFn: api.rivianDiagnostics,
    refetchInterval: live ? 10_000 : false,
  });
}

export function useRivianDisconnect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.rivianDisconnect,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['status'] }),
  });
}
