import type { LiveSessionData } from "../rivian/types.js";
import { isChargingState } from "./charging-time.js";

/**
 * Charge readings kept per vehicle. Parallax is the better source and wins
 * where it reports; legacy vehicle state fills in until it does.
 */
export interface DerivedChargeInputs {
  /** Legacy chargerState, and when it last changed. */
  chargerState: string | null;
  chargerStateAt: string | null;
  /** The same, from Parallax's charging status. */
  parallaxChargerState: string | null;
  parallaxChargerStateAt: string | null;
  /** Legacy batteryLevel, and when it last changed. */
  soc: number | null;
  socAt: string | null;
  /** Legacy timeToEndOfCharge, in minutes. */
  minutesLeft: number | null;
  stateAt: string;
  /** Parallax battery_state SOC and pack capacity. */
  parallaxSoc: number | null;
  parallaxSocAt: string | null;
  capacityKwh: number | null;
  /** Parallax time estimation; null once it clears. Unset until it reports. */
  parallaxMinutesLeft: number | null;
  parallaxMinutesAt: string | null;
  /** Parallax charge-limit slider. */
  socLimit: number | null;
  socLimitAt: string | null;
  /** Live power: the breakdown's, or the charging graph's latest bar. */
  powerKw: number | null;
  powerAt: string | null;
  /** Running totals and live rate from Parallax's charge breakdown. */
  energyKwh: number | null;
  energyAt: string | null;
  rangeAddedKm: number | null;
  rangeKmPerHour: number | null;
  rateAt: string | null;
}

export function emptyChargeInputs(at: string): DerivedChargeInputs {
  return {
    chargerState: null,
    chargerStateAt: null,
    parallaxChargerState: null,
    parallaxChargerStateAt: null,
    soc: null,
    socAt: null,
    minutesLeft: null,
    stateAt: at,
    parallaxSoc: null,
    parallaxSocAt: null,
    capacityKwh: null,
    parallaxMinutesLeft: null,
    parallaxMinutesAt: null,
    socLimit: null,
    socLimitAt: null,
    powerKw: null,
    powerAt: null,
    energyKwh: null,
    energyAt: null,
    rangeAddedKm: null,
    rangeKmPerHour: null,
    rateAt: null,
  };
}

/** The more recent of a legacy reading and its Parallax counterpart. */
function newer<T>(legacy: T, legacyAt: string | null, parallax: T, parallaxAt: string | null): { value: T; at: string | null } {
  return parallaxAt != null && (legacyAt == null || Date.parse(parallaxAt) >= Date.parse(legacyAt))
    ? { value: parallax, at: parallaxAt }
    : { value: legacy, at: legacyAt };
}

/** The charger state from whichever source changed last. */
export function currentChargerState(f: DerivedChargeInputs): string | null {
  return newer(f.chargerState, f.chargerStateAt, f.parallaxChargerState, f.parallaxChargerStateAt).value;
}

/**
 * A live session built from Parallax and vehicle state, for when Rivian's
 * chargingSession push stays silent (it does for some chargers and
 * accounts). Null unless the vehicle reports it's charging.
 */
export function derivedLiveSession(
  startedAt: number,
  f: DerivedChargeInputs,
): LiveSessionData | null {
  const chargerState = currentChargerState(f);
  if (!isChargingState(chargerState)) return null;
  const rec = (value: number | null, at: string | null) =>
    value == null || at == null ? null : { value, updatedAt: at };

  // Whichever SOC changed last; both read the same pack.
  const soc = newer(f.soc, f.socAt, f.parallaxSoc, f.parallaxSocAt);
  // 0 means no estimate (e.g. scheduled). The push feed reports seconds.
  const minutes = f.parallaxMinutesAt != null ? f.parallaxMinutesLeft : f.minutesLeft;
  const minutesAt = f.parallaxMinutesAt ?? f.stateAt;

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
    soc: rec(soc.value, soc.at ?? f.stateAt),
    timeRemaining: rec(minutes ? minutes * 60 : null, minutesAt),
    totalChargedEnergy: rec(f.energyKwh, f.energyAt),
    rangeAddedThisSession: rec(f.rangeAddedKm, f.energyAt),
    kilometersChargedPerHour: rec(f.rangeKmPerHour, f.rateAt),
    socLimit: rec(f.socLimit, f.socLimitAt),
    batteryCapacityKwh: rec(f.capacityKwh, f.parallaxSocAt),
    vehicleChargerState: { value: chargerState, updatedAt: f.stateAt },
    chart: [],
  };
}
