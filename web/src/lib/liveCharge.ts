import type { LiveSessionData, VehicleState } from '@server/api-types';
import { clock } from './format';
import { nv } from './state';

/** A charge in progress, as numbers: how full, how fast, how much, and when it's done. */
export interface LiveCharge {
  soc: number | null;
  limit: number | null;
  powerKw: number | null;
  /** Range added per hour (km). */
  rateKmh: number | null;
  energyKwh: number | null;
  rangeAddedKm: number | null;
  secondsLeft: number | null;
  /** When it should finish, e.g. "4:20 AM". */
  finish: string | null;
}

/** The live session's readings, falling back to vehicle state for battery level and limit. */
export function liveCharge(
  live: LiveSessionData | null | undefined,
  state: VehicleState | undefined,
): LiveCharge {
  const secondsLeft = num(live?.timeRemaining?.value);
  // Counted from when the vehicle reported the time left.
  const reportedAt = Date.parse(live?.timeRemaining?.updatedAt ?? '');
  return {
    soc: num(live?.soc?.value) ?? nv(state, 'batteryLevel'),
    limit: num(live?.socLimit?.value) ?? nv(state, 'batteryLimit'),
    powerKw: num(live?.power?.value),
    rateKmh: num(live?.kilometersChargedPerHour?.value),
    energyKwh: num(live?.totalChargedEnergy?.value),
    rangeAddedKm: num(live?.rangeAddedThisSession?.value),
    secondsLeft,
    finish:
      secondsLeft != null && secondsLeft > 0 && Number.isFinite(reportedAt)
        ? clock(reportedAt + secondsLeft * 1000)
        : null,
  };
}

/** Whether the live session says the vehicle is charging. */
export function isChargingLive(live: LiveSessionData | null | undefined): boolean {
  return live?.vehicleChargerState?.value === 'charging_active';
}

function num(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
