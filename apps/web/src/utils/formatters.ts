import type { UnitPrefs } from "../types/index.js";

export function formatPercent(value: number | null | undefined): string {
  return value == null ? "—" : `${Math.round(value)}%`;
}

export function formatDistance(value: number | null | undefined, prefs: UnitPrefs): string {
  if (value == null) return "—";
  if (prefs.distance === "km") return `${value.toFixed(1)} km`;
  return `${(value * 0.621371).toFixed(1)} mi`;
}

export function formatRange(value: number | null | undefined, prefs?: UnitPrefs): string {
  if (value == null) return "No range data";
  if (prefs?.distance === "km") return `${Math.round(value)} km estimated`;
  return `${Math.round(value * 0.621371)} mi estimated`;
}

export function formatSpeed(value: number | null | undefined, prefs?: UnitPrefs): string {
  if (value == null) return "—";
  if (prefs?.distance === "km") return `${Math.round(value * 3.6)} km/h`;
  return `${Math.round(value * 2.23694)} mph`;
}

/** Legacy — always converts km→mi. Prefer formatDistance with prefs. */
export function formatKm(value: number | null | undefined): string {
  return value == null ? "—" : `${(value * 0.621371).toFixed(1)} mi`;
}

export function formatKwh(value: number | null | undefined): string {
  return value == null ? "—" : `${value.toFixed(2)} kWh`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatCoordinates(
  latitude: number | null | undefined,
  longitude: number | null | undefined
): string {
  if (latitude == null || longitude == null) return "No location yet";
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

export function formatTemperature(
  celsius: number | null | undefined,
  prefs: UnitPrefs
): string {
  if (celsius == null) return "—";
  if (prefs.temperature === "c") return `${celsius.toFixed(1)} °C`;
  return `${(celsius * 9 / 5 + 32).toFixed(1)} °F`;
}

export function titleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}
