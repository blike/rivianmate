import type { VehicleState } from "@server/api-types.js";

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

export function location(
  state: VehicleState | undefined,
): { lat: number; lon: number; ts: string } | null {
  const loc = state?.gnssLocation;
  if (!loc || typeof loc.latitude !== "number") return null;
  return { lat: loc.latitude, lon: loc.longitude, ts: loc.timeStamp };
}

export function fmt(n: number | null | undefined, digits = 0): string {
  if (n == null) return "—";
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
  if (!value) return "—";
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
