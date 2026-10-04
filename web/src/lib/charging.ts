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

/**
 * Where a charge in progress is headed. Rivian's time remaining runs to the
 * end of the session, which a charging schedule can cut short of the limit;
 * the SoC it will reach by then is estimated from power and pack size.
 * "session" when it stops more than a point short of the limit.
 */
export function chargeOutlook(i: {
  soc: number | null;
  limit: number | null;
  powerKw: number | null;
  capacityKwh: number | null;
  minutesLeft: number | null;
}): { kind: "limit" | "session"; minutes: number | null; endSoc: number | null } {
  const { soc, limit, powerKw, capacityKwh, minutesLeft } = i;
  // Percent per minute, ignoring charging losses (a slight overestimate).
  const rate = powerKw && capacityKwh ? (powerKw / capacityKwh) * 100 / 60 : null;
  if (minutesLeft != null && rate != null && soc != null && limit != null) {
    const endSoc = Math.min(limit, soc + rate * minutesLeft);
    if (endSoc < limit - 1) return { kind: "session", minutes: minutesLeft, endSoc };
  }
  const toLimit = rate != null && soc != null && limit != null && soc < limit ? (limit - soc) / rate : null;
  return { kind: "limit", minutes: minutesLeft ?? toLimit, endSoc: limit };
}
