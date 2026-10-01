import type { TimeStampedValue, VehicleState } from "../rivian/types.js";
import { stateNumber, stateString } from "./state-utils.js";

/** Rivian's clock can run slightly ahead of ours; anything further is bogus. */
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

/** Vehicle `chargerState` while energy is flowing into the battery. */
export function isChargingState(value: string | null | undefined): boolean {
  return value?.toLowerCase() === "charging_active";
}

/**
 * When Rivian stamped `key`, or `fallback` when it's missing or implausibly
 * in the future. A value's stamp is when it changed only on the delta that
 * changed it; afterwards Rivian re-stamps it on each report.
 */
export function stampedAt(state: VehicleState, key: string, fallback: number): number {
  const stamp = (state[key] as TimeStampedValue | undefined)?.timeStamp;
  const at = stamp ? Date.parse(stamp) : Number.NaN;
  return Number.isFinite(at) && at <= fallback + MAX_CLOCK_SKEW_MS ? Math.min(at, fallback) : fallback;
}

export interface ChargerObservation {
  at: number;
  charging: boolean;
}

export interface SocObservation {
  at: number;
  soc: number;
}

/**
 * Seconds spent charging within [start, end], from charger-state readings.
 * A stretch still charging at the last reading runs to `until`.
 */
export function chargingSecondsBetween(
  readings: readonly ChargerObservation[],
  start: number,
  end: number,
  until = end,
): number {
  const clamp = (t: number) => Math.min(Math.max(t, start), end);
  let total = 0;
  let since: number | null = null;
  for (const r of [...readings].sort((a, b) => a.at - b.at)) {
    if (r.charging && since === null) since = clamp(r.at);
    else if (!r.charging && since !== null) {
      total += clamp(r.at) - since;
      since = null;
    }
  }
  if (since !== null) total += Math.max(0, clamp(until) - since);
  return Math.round(total / 1000);
}

export interface DerivedChargingStats {
  chargingSeconds: number | null;
  startSoc: number | null;
  endSoc: number | null;
}

/**
 * Charging time and SOC for a plug-in session [start, end], rebuilt from
 * recorded vehicle states (e.g. a session imported from Rivian's history
 * that RivianMate watched but didn't record live). Readings are placed by
 * Rivian's own timestamps. Charging time needs at least one charger reading
 * inside the session; a final charging stretch is only counted up to the
 * last reading, so a gap in recording never inflates it.
 */
export function deriveChargingStats(
  states: readonly VehicleState[],
  start: number,
  end: number,
): DerivedChargingStats {
  const { charger, socs } = readingsFrom(states);
  const inside = charger.filter((r) => r.at >= start && r.at <= end);
  const lastSeen = Math.max(...[...charger, ...socs].map((r) => r.at).filter((t) => t <= end));
  const chargingSeconds =
    inside.length > 0
      ? chargingSecondsBetween(charger.filter((r) => r.at <= end), start, end, lastSeen)
      : null;

  const startSoc = (socs.find((s) => s.at >= start) ?? socs.filter((s) => s.at < start).at(-1))?.soc ?? null;
  const endSoc = socs.filter((s) => s.at <= end).at(-1)?.soc ?? null;
  return { chargingSeconds, startSoc, endSoc };
}

/** Battery-level readings within [start, end], for a SOC-only curve. */
export function socReadingsBetween(
  states: readonly VehicleState[],
  start: number,
  end: number,
): SocObservation[] {
  return readingsFrom(states).socs.filter((s) => s.at >= start && s.at <= end);
}

/** Distinct charger-state and SOC readings, by Rivian's timestamps, in time order. */
function readingsFrom(states: readonly VehicleState[]): {
  charger: ChargerObservation[];
  socs: SocObservation[];
} {
  const charger = new Map<number, ChargerObservation>();
  const socs = new Map<number, SocObservation>();
  for (const state of states) {
    const chargerState = stateString(state, "chargerState");
    if (chargerState !== null) {
      const at = stampedAt(state, "chargerState", Number.POSITIVE_INFINITY);
      if (Number.isFinite(at)) charger.set(at, { at, charging: isChargingState(chargerState) });
    }
    const soc = stateNumber(state, "batteryLevel");
    if (soc !== null) {
      const at = stampedAt(state, "batteryLevel", Number.POSITIVE_INFINITY);
      if (Number.isFinite(at)) socs.set(at, { at, soc });
    }
  }
  const byTime = <T extends { at: number }>(m: Map<number, T>) => [...m.values()].sort((a, b) => a.at - b.at);
  return { charger: byTime(charger), socs: byTime(socs) };
}
