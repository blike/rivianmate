import type { TimeStampedValue, VehicleState } from '../rivian/types.js';
import { stateNumber, stateString } from './state-utils.js';

/** Rivian's clock can run slightly ahead of ours; anything further is bogus. */
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

/** Vehicle `chargerState` values while energy is flowing into the battery. */
const CHARGING_STATES = new Set(['charging_active', 'charging_smart_charging_active']);

/** Vehicle `chargerState` while energy is flowing into the battery. */
export function isChargingState(value: string | null | undefined): boolean {
  return CHARGING_STATES.has(value?.toLowerCase() ?? '');
}

/**
 * States a charge ends in for good: it reached its limit, the owner stopped
 * it, or a schedule did. Charging again after one is a new charge.
 */
const FINAL_STATES = new Set(['charging_complete', 'charging_user_stopped', 'charging_scheduled']);

export function endsCharge(value: string | null | undefined): boolean {
  return FINAL_STATES.has(value?.toLowerCase() ?? '');
}

/**
 * Whether a stop is a pause the car means to resume from: Smart Charging
 * holding it, or any stop that isn't final while time to the end is still
 * counted. A stop that ends the charge has neither.
 */
export function holdsCharge(
  value: string | null | undefined,
  minutesLeft: number | null | undefined,
): boolean {
  if (endsCharge(value)) return false;
  if (value?.toLowerCase() === 'charging_smart_charging_paused') return true;
  return (minutesLeft ?? 0) > 0;
}

/**
 * When Rivian stamped `key`, or `fallback` when it's missing or implausibly
 * in the future. A value's stamp is when it changed only on the delta that
 * changed it; afterwards Rivian re-stamps it on each report.
 */
export function stampedAt(state: VehicleState, key: string, fallback: number): number {
  const stamp = (state[key] as TimeStampedValue | undefined)?.timeStamp;
  const at = stamp ? Date.parse(stamp) : Number.NaN;
  return Number.isFinite(at) && at <= fallback + MAX_CLOCK_SKEW_MS
    ? Math.min(at, fallback)
    : fallback;
}

/**
 * A charge that stops without ending (a station dropping out, a handshake
 * retried) and starts again within this is the same charge.
 */
export const RESTART_JOIN_MS = 2 * 60_000;

/**
 * A breakdown carries no session id or time, only minutes spent charging,
 * so it goes to the charge whose charging time matches. Rivian resends the
 * previous session's breakdown on subscribe, which this keeps off a new one.
 */
export const BREAKDOWN_MATCH_MIN_S = 5 * 60;
const BREAKDOWN_MATCH_FRACTION = 0.1;
export const breakdownMatches = (minutes: number, chargingSeconds: number) =>
  Math.abs(minutes * 60 - chargingSeconds) <=
  Math.max(BREAKDOWN_MATCH_MIN_S, chargingSeconds * BREAKDOWN_MATCH_FRACTION);

/** A charger reading from vehicle state, as recorded in state history. */
export interface ChargerReading {
  at: number;
  /** Whether it's plugged in; null when the reading doesn't say. */
  plugged: boolean | null;
  chargerState: string | null;
  minutesLeft: number | null;
  soc: number | null;
}

/** One charge: from when charging started to when it stopped for good. */
export interface ChargeRun {
  from: number;
  to: number;
  /** The stretches it spent charging; more than one when it paused. */
  stretches: { from: number; to: number }[];
  startSoc: number | null;
  endSoc: number | null;
}

/**
 * The charges in a run of charger readings (in order), by the rules the
 * charging monitor records them with: a charge starts when charging does and
 * ends when it stops for good or the car is unplugged. A pause the car means
 * to resume from (`holdsCharge`) stays in it, as does a restart within
 * `RESTART_JOIN_MS` of a stop that wasn't final. One still going at the last
 * reading runs to `until`.
 */
export function chargeRuns(readings: readonly ChargerReading[], until: number): ChargeRun[] {
  type Open = ChargeRun & { since: number | null; pausedAt: number | null; final: boolean };
  const runs: Open[] = [];
  let run: Open | null = null;
  let soc: number | null = null;

  const end = (at: number, final: boolean) => {
    if (!run) return;
    if (run.since !== null) {
      run.stretches.push({ from: run.since, to: at });
      run.since = null;
    }
    run.to = run.stretches.at(-1)?.to ?? run.from;
    run.endSoc = soc;
    run.final = final;
    runs.push(run);
    run = null;
  };

  for (const r of readings) {
    if (r.soc !== null) soc = r.soc;
    if (r.plugged === false) {
      end(run?.since != null ? r.at : (run?.pausedAt ?? r.at), true);
      continue;
    }
    const charging = isChargingState(r.chargerState);
    if (!run) {
      if (!charging) continue;
      const last = runs.at(-1);
      if (last && !last.final && r.at - last.to <= RESTART_JOIN_MS) {
        run = runs.pop()!;
        run.since = r.at;
        run.pausedAt = null;
      } else {
        run = {
          from: r.at,
          to: r.at,
          stretches: [],
          startSoc: soc,
          endSoc: soc,
          since: r.at,
          pausedAt: null,
          final: false,
        };
      }
      continue;
    }
    if (charging) {
      if (run.since === null) {
        run.since = r.at;
        run.pausedAt = null;
      }
      continue;
    }
    // A reading without a charger state says nothing about charging.
    if (r.chargerState === null) continue;
    if (!holdsCharge(r.chargerState, r.minutesLeft)) {
      end(run.since !== null ? r.at : (run.pausedAt ?? r.at), endsCharge(r.chargerState));
      continue;
    }
    if (run.since !== null) {
      run.stretches.push({ from: run.since, to: r.at });
      run.since = null;
      run.pausedAt = r.at;
    }
  }
  if (run) end((run as Open).since !== null ? until : ((run as Open).pausedAt ?? until), false);
  return runs.map(({ from, to, stretches, startSoc, endSoc }) => ({
    from,
    to,
    stretches,
    startSoc,
    endSoc,
  }));
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
 * last reading (or `seenAt` time), so a gap in recording never inflates it.
 */
export function deriveChargingStats(
  states: readonly VehicleState[],
  start: number,
  end: number,
  /** Other times state was received, which show values still held then. */
  seenAt: readonly number[] = [],
): DerivedChargingStats {
  const { charger, socs } = readingsFrom(states);
  const inside = charger.filter((r) => r.at >= start && r.at <= end);
  const lastSeen = Math.max(
    ...[...charger, ...socs].map((r) => r.at).filter((t) => t <= end),
    ...seenAt.filter((t) => t <= end),
  );
  const chargingSeconds =
    inside.length > 0
      ? chargingSecondsBetween(
          charger.filter((r) => r.at <= end),
          start,
          end,
          lastSeen,
        )
      : null;

  const startSoc =
    (socs.find((s) => s.at >= start) ?? socs.filter((s) => s.at < start).at(-1))?.soc ?? null;
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
    const chargerState = stateString(state, 'chargerState');
    if (chargerState !== null) {
      const at = stampedAt(state, 'chargerState', Number.POSITIVE_INFINITY);
      if (Number.isFinite(at)) charger.set(at, { at, charging: isChargingState(chargerState) });
    }
    const soc = stateNumber(state, 'batteryLevel');
    if (soc !== null) {
      const at = stampedAt(state, 'batteryLevel', Number.POSITIVE_INFINITY);
      if (Number.isFinite(at)) socs.set(at, { at, soc });
    }
  }
  const byTime = <T extends { at: number }>(m: Map<number, T>) =>
    [...m.values()].sort((a, b) => a.at - b.at);
  return { charger: byTime(charger), socs: byTime(socs) };
}
