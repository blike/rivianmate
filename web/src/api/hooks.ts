import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import type { LiveSessionData, VehicleState } from "@server/api-types.js";
import { DEFAULT_UNITS, unitFormatter } from "../lib/units.js";
import { api, type UnitPreferences } from "./client.js";

export function useStatus() {
  return useQuery({ queryKey: ["status"], queryFn: api.status, staleTime: 5000 });
}

export function useVehicles(enabled = true) {
  return useQuery({ queryKey: ["vehicles"], queryFn: api.vehicles, enabled });
}

export function useVehicleState(vehicleId: string | undefined) {
  return useQuery({
    queryKey: ["vehicleState", vehicleId],
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
    source.addEventListener("state", (event) => {
      const state = JSON.parse((event as MessageEvent).data) as VehicleState;
      queryClient.setQueryData(["vehicleState", vehicleId], state);
    });
    source.addEventListener("charging", (event) => {
      const session = JSON.parse(
        (event as MessageEvent).data,
      ) as LiveSessionData | null;
      queryClient.setQueryData(["liveCharging", vehicleId], session);
    });
    return () => source.close();
  }, [vehicleId, queryClient]);
}

export function useLiveCharging(vehicleId: string | undefined) {
  return useQuery<LiveSessionData | null>({
    queryKey: ["liveCharging", vehicleId],
    queryFn: () => null,
    enabled: false,
    staleTime: Infinity,
  });
}

/** App-wide unit preferences plus ready-made formatters. */
export function useUnits() {
  const { data } = useQuery({
    queryKey: ["units"],
    queryFn: api.units,
    staleTime: Infinity,
  });
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
    onMutate: (units) => queryClient.setQueryData(["units"], units),
    onSuccess: (units) => queryClient.setQueryData(["units"], units),
    onError: () => queryClient.invalidateQueries({ queryKey: ["units"] }),
  });
}

export function useRivianDiagnostics() {
  return useQuery({
    queryKey: ["rivianDiagnostics"],
    queryFn: api.rivianDiagnostics,
    refetchInterval: 30_000,
  });
}

export function useRivianDisconnect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.rivianDisconnect,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["status"] }),
  });
}
