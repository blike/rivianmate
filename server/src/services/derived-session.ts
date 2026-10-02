import type { LiveSessionData } from "../rivian/types.js";
import { isChargingState } from "./charging-time.js";

/** Charge readings from vehicle state and Parallax, kept per vehicle. */
export interface DerivedChargeInputs {
  chargerState: string | null;
  soc: number | null;
  /** Vehicle state's timeToEndOfCharge, in minutes. */
  minutesLeft: number | null;
  stateAt: string;
  /** Latest bar of Parallax's charging graph (16-minute buckets). */
  powerKw: number | null;
  powerAt: string | null;
  /** Running total from Parallax's charge breakdown. */
  energyKwh: number | null;
  energyAt: string | null;
}

/**
 * A live session built from vehicle state and Parallax, for when Rivian's
 * chargingSession push stays silent (it does for some chargers and
 * accounts). Null unless the vehicle reports it's charging.
 */
export function derivedLiveSession(
  startedAt: number,
  f: DerivedChargeInputs,
): LiveSessionData | null {
  if (!isChargingState(f.chargerState)) return null;
  const rec = (value: number | null, at: string | null) =>
    value == null || at == null ? null : { value, updatedAt: at };
  return {
    chargerId: null,
    currentCurrency: null,
    currentPrice: null,
    isFreeSession: null,
    isRivianCharger: null,
    locationId: null,
    startTime: new Date(startedAt).toISOString(),
    timeElapsed: null,
    power: rec(f.powerKw, f.powerAt),
    soc: rec(f.soc, f.stateAt),
    // The push feed reports seconds; 0 means no estimate (e.g. scheduled).
    timeRemaining: rec(f.minutesLeft ? f.minutesLeft * 60 : null, f.stateAt),
    totalChargedEnergy: rec(f.energyKwh, f.energyAt),
    vehicleChargerState: { value: f.chargerState, updatedAt: f.stateAt },
    chart: [],
  };
}
