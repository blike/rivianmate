import type { VehicleState } from '@server/api-types';
import { NAV_COVERS_MS } from '@server/services/state-utils';
import { isPosition } from './geo';

interface ValueRecord {
  timeStamp?: string;
  value?: string | number | null;
}

export function sv(state: VehicleState | undefined, key: string): string | null {
  const record = state?.[key] as ValueRecord | undefined;
  if (record?.value == null) return null;
  return String(record.value);
}

export function nv(state: VehicleState | undefined, key: string): number | null {
  const record = state?.[key] as ValueRecord | undefined;
  if (record?.value == null) return null;
  const n = Number(record.value);
  return Number.isFinite(n) ? n : null;
}

export interface VehicleFix {
  lat: number;
  lon: number;
  ts: string;
  /** Heading (°, 0–360) and speed (m/s) taken with the fix, where it has them. */
  bearing: number | null;
  speedMps: number | null;
}

/**
 * Where the vehicle is, by the rule its stored track follows: the navigation
 * fix while one is running, and the vehicle's own GPS fix once that is more
 * than NAV_COVERS_MS newer. An R2 reports its own fix about once a minute, so
 * while it navigates the map moves every 5 s instead. The server only keeps a
 * navigation fix where legacy GPS isn't already a track of its own (an R1).
 */
export function location(state: VehicleState | undefined): VehicleFix | null {
  const gnss = state?.gnssLocation;
  const nav = state?.navLocation;
  const gnssOk = gnss != null && isPosition(gnss.latitude, gnss.longitude);
  if (nav && isPosition(nav.latitude, nav.longitude)) {
    const navAt = Date.parse(nav.timeStamp);
    const gnssAt = gnssOk ? Date.parse(gnss.timeStamp) : Number.NaN;
    if (Number.isFinite(navAt) && !(gnssAt - navAt > NAV_COVERS_MS)) {
      return {
        lat: nav.latitude,
        lon: nav.longitude,
        ts: nav.timeStamp,
        bearing: nav.bearing ?? null,
        speedMps: nav.speedMps ?? null,
      };
    }
  }
  if (!gnssOk) return null;
  return {
    lat: gnss.latitude,
    lon: gnss.longitude,
    ts: gnss.timeStamp,
    bearing: nv(state, 'gnssBearing'),
    speedMps: nv(state, 'gnssSpeed'),
  };
}

export function fmt(n: number | null | undefined, digits = 0): string {
  if (n == null) return '—';
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtDuration(startIso: string, endIso: string | null, now = Date.now()): string {
  const end = endIso ? new Date(endIso).getTime() : now;
  return fmtSeconds((end - new Date(startIso).getTime()) / 1000);
}

/** "45m" or "5h 13m". */
export function fmtSeconds(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function titleCase(value: string | null): string {
  if (!value) return '—';
  return value.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
