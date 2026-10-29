import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import type { LiveSessionData, NotificationSettingsUpdate, VehicleState } from '@server/api-types';
import { LIST_LIMIT } from '@server/list-page';
import { location } from '../lib/state';
import { DEFAULT_UNITS, unitFormatter } from '../lib/units';
import {
  api,
  type TeslaMateSettingsDto,
  type ChargingSettings,
  type LookupSettings,
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
      // Kept as they arrive, not as pages redraw: updates that come together
      // (or in a background tab) are drawn once, which would skip a fix.
      const fix = location(state);
      if (fix) {
        queryClient.setQueryData<LiveFix[]>(['liveFixes', vehicleId], (fixes = []) =>
          withFix(fixes, fix),
        );
      }
    });
    source.addEventListener('charging', (event) => {
      const session = JSON.parse((event as MessageEvent).data) as LiveSessionData | null;
      queryClient.setQueryData(['liveCharging', vehicleId], session);
    });
    return () => source.close();
  }, [vehicleId, queryClient]);
}

export type LiveFix = NonNullable<ReturnType<typeof location>>;

/** How long live GPS fixes are kept: well past the drive's refresh, which stores them. */
const FIXES_KEPT_MS = 10 * 60_000;

/** The fixes kept with a new one from the stream: a repeat isn't added, and old ones go. */
export function withFix(fixes: LiveFix[], fix: LiveFix): LiveFix[] {
  if (fixes.at(-1)?.ts === fix.ts) return fixes;
  const from = Date.parse(fix.ts) - FIXES_KEPT_MS;
  return [...fixes.filter((f) => Date.parse(f.ts) > from), fix];
}

/** The GPS fixes the live stream has sent recently, oldest first. */
export function useLiveFixes(vehicleId: string): LiveFix[] {
  const { data } = useQuery<LiveFix[]>({
    queryKey: ['liveFixes', vehicleId],
    queryFn: () => [],
    enabled: false,
    staleTime: Infinity,
  });
  return data ?? [];
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
/** A listing with older pages loaded refreshes at most this often. */
const OLDER_PAGES_REFRESH_MS = 5 * 60_000;

/** The newest drives, or with `since`, all of them from then on. */
export function useDrives(vehicleId: string, since?: Date) {
  return useQuery({
    queryKey: since ? ['drives', vehicleId, since.toISOString()] : ['drives', vehicleId],
    queryFn: () => api.drives(vehicleId, { from: since }),
    // A drive in progress grows by the second.
    refetchInterval: (query) =>
      query.state.data?.some((d) => !d.endedAt) ? LIVE_REFRESH_MS : 60_000,
    placeholderData: since ? keepPreviousData : undefined,
  });
}

/**
 * A listing read a page at a time, newest first: `items` so far, and
 * `loadOlder` for the next page while there may be more.
 */
function usePages<T extends { startedAt: string }>(
  queryKey: readonly unknown[],
  fetchPage: (before?: Date) => Promise<T[]>,
  refetchInterval: (items: T[]) => number,
) {
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: undefined as Date | undefined,
    // A full page may have more behind it.
    getNextPageParam: (last: T[]) =>
      last.length >= LIST_LIMIT ? new Date(last.at(-1)!.startedAt) : undefined,
    // A refresh refetches every page loaded, so once older ones are, less often.
    refetchInterval: (q) => {
      const pages = q.state.data?.pages ?? [];
      const ms = refetchInterval(pages.flat());
      return pages.length > 1 ? Math.max(ms, OLDER_PAGES_REFRESH_MS) : ms;
    },
  });
  const items = useMemo(() => query.data?.pages.flat(), [query.data]);
  return {
    items,
    isPending: query.isPending,
    hasOlder: query.hasNextPage,
    loadingOlder: query.isFetchingNextPage,
    loadOlder: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    },
  };
}

/** Every drive, a page at a time, for the Drives page. */
export function useDrivePages(vehicleId: string) {
  // Under the drives key, so whatever refreshes drives refreshes these.
  return usePages(
    ['drives', vehicleId, 'pages'],
    (before) => api.drives(vehicleId, { before }),
    (items) => (items.some((d) => !d.endedAt) ? LIVE_REFRESH_MS : 60_000),
  );
}

/** Every charging session, a page at a time, for the Charging page. */
export function useChargingPages(vehicleId: string) {
  return usePages(
    ['chargingSessions', vehicleId, 'pages'],
    (before) => api.chargingSessions(vehicleId, { before }),
    () => 60_000,
  );
}

/** When drive history starts, which charging history can reach back before. */
export function useDriveCoverage(vehicleId: string) {
  return useQuery({
    queryKey: ['driveCoverage', vehicleId],
    queryFn: () => api.driveCoverage(vehicleId),
    staleTime: 10 * 60_000,
  });
}

export function useDrive(vehicleId: string, driveId: number | null) {
  return useQuery({
    // Drive ids are per source, so a Rivian and a TeslaMate drive can share one.
    queryKey: ['drive', vehicleId, driveId],
    queryFn: () => api.drive(vehicleId, driveId!),
    enabled: driveId != null,
    refetchInterval: (query) =>
      query.state.data && !query.state.data.endedAt ? LIVE_REFRESH_MS : false,
    // Keep the previous drive on screen while the next one loads.
    placeholderData: keepPreviousData,
  });
}

/** The newest sessions, or with `since`, all of them from then on. */
export function useChargingSessions(vehicleId: string, since?: Date) {
  return useQuery({
    queryKey: since
      ? ['chargingSessions', vehicleId, since.toISOString()]
      : ['chargingSessions', vehicleId],
    queryFn: () => api.chargingSessions(vehicleId, { from: since }),
    refetchInterval: 60_000,
    placeholderData: since ? keepPreviousData : undefined,
  });
}

/** The charging and departure schedules set in the Rivian app. */
export function useSchedules(vehicleId: string) {
  return useQuery({
    queryKey: ['schedules', vehicleId],
    queryFn: () => api.schedules(vehicleId),
    refetchInterval: 5 * 60_000,
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

export function useLookupSettings() {
  return useQuery({ queryKey: ['lookups'], queryFn: api.lookups, staleTime: Infinity });
}

export function useSetLookupSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (lookups: LookupSettings) => api.setLookups(lookups),
    onMutate: (lookups) => queryClient.setQueryData(['lookups'], lookups),
    onSuccess: (lookups) => {
      queryClient.setQueryData(['lookups'], lookups);
      // Unnamed places show their coordinates only while address lookups are off.
      void queryClient.invalidateQueries({ queryKey: ['drives'] });
      void queryClient.invalidateQueries({ queryKey: ['drive'] });
    },
    onError: () => queryClient.invalidateQueries({ queryKey: ['lookups'] }),
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

export function useTeslaMate(live = true) {
  return useQuery({
    queryKey: ['teslamate'],
    queryFn: api.teslamate,
    refetchInterval: live ? 10_000 : false,
  });
}

/** Saving or removing TeslaMate changes which vehicles there are. */
function useOnTeslaMateSaved() {
  const queryClient = useQueryClient();
  return (settings: TeslaMateSettingsDto) => {
    queryClient.setQueryData(['teslamate'], settings);
    void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
    void queryClient.invalidateQueries({ queryKey: ['status'] });
  };
}

export function useSetTeslaMate() {
  const onSuccess = useOnTeslaMateSaved();
  return useMutation({ mutationFn: (url: string) => api.setTeslamate(url), onSuccess });
}

export function useRemoveTeslaMate() {
  const onSuccess = useOnTeslaMateSaved();
  return useMutation({ mutationFn: api.removeTeslamate, onSuccess });
}
