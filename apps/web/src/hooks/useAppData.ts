import { useEffect, useState } from "react";
import { fetchJson } from "../api/client.js";
import type {
  AppData,
  AuthSession,
  ChargingSessionSummary,
  DataQualitySummary,
  DriveSummary,
  OverviewSnapshot,
  RivianCredentialStatus,
  SetupStatus,
  SnapshotHistoryPoint,
  VehicleSummary,
} from "../types/index.js";

const INITIAL: AppData = {
  setup: null,
  auth: null,
  rivianCredentials: null,
  overview: null,
  vehicles: [],
  drives: [],
  charging: [],
  dataQuality: null,
  history: [],
  loading: true,
  error: null,
};

export function useAppData() {
  const [data, setData] = useState<AppData>(INITIAL);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const setup = await fetchJson<SetupStatus>("/api/setup");
        if (!setup.adminConfigured) {
          if (!cancelled) setData((s) => ({ ...s, setup, loading: false, error: null }));
          return;
        }

        const auth = await fetchJson<AuthSession>("/api/auth/session");
        if (!auth.authenticated) {
          if (!cancelled) setData((s) => ({ ...s, auth, setup, loading: false, error: null }));
          return;
        }

        const [rivianCredentials, overview, vehicles, drives, charging, dataQuality, history] =
          await Promise.all([
            fetchJson<RivianCredentialStatus>("/api/rivian/credentials"),
            fetchJson<OverviewSnapshot>("/api/overview"),
            fetchJson<VehicleSummary[]>("/api/vehicles"),
            fetchJson<DriveSummary[]>("/api/drives"),
            fetchJson<ChargingSessionSummary[]>("/api/charging-sessions"),
            fetchJson<DataQualitySummary>("/api/data-quality"),
            fetchJson<SnapshotHistoryPoint[]>("/api/history/snapshots"),
          ]);

        if (!cancelled) {
          setData({
            auth,
            charging,
            dataQuality,
            drives,
            error: null,
            history,
            loading: false,
            overview,
            rivianCredentials,
            setup,
            vehicles,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setData((s) => ({
            ...s,
            loading: false,
            error: error instanceof Error ? error.message : "Unable to load RivianMate data.",
          }));
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return data;
}
