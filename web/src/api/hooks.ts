import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect } from "react";
import type { LiveSessionData, VehicleState } from "@server/api-types.js";
import { api } from "./client.js";

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

export function useRivianDisconnect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.rivianDisconnect,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["status"] }),
  });
}
