import type { ChargingSessionDto } from "@server/api-types.js";
import { fmt, titleCase } from "./state.js";

/**
 * Seconds spent charging so far, counting a stretch still running; null
 * when RivianMate didn't watch the session.
 */
export function chargingSecondsNow(
  s: Pick<ChargingSessionDto, "chargingSeconds" | "chargingSince">,
  now = Date.now(),
): number | null {
  if (s.chargingSeconds == null && s.chargingSince == null) return null;
  const running = s.chargingSince ? Math.max(0, now - Date.parse(s.chargingSince)) / 1000 : 0;
  return (s.chargingSeconds ?? 0) + running;
}

/** "40→70%", with "?" for an unknown end, or "—" when both are unknown. */
export function socRange(start: number | null, end: number | null): string {
  if (start == null && end == null) return "—";
  const part = (v: number | null) => (v == null ? "?" : fmt(v, 0));
  return `${part(start)}→${part(end)}%`;
}

export function formatMoney(amount: string, currency: string | null): string {
  const prefix = currency === "USD" || !currency ? "$" : `${currency} `;
  return `${prefix}${fmt(Number(amount), 2)}`;
}

export function chargerLabel(
  s: Pick<ChargingSessionDto, "chargerType" | "isHome" | "vendor" | "chargerId">,
): string {
  if (s.chargerType === "rivian_charger") return "Rivian Adventure Network";
  if (s.isHome) return "Home";
  if (s.vendor) return titleCase(s.vendor.toLowerCase());
  return s.chargerId ?? titleCase(s.chargerType);
}
