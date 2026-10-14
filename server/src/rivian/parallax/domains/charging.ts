/**
 * `charging.*`: the session the vehicle is running. Most of these are
 * logged in full while their formats are worked out.
 */
import type { ChargingSchedule } from '../../types.js';
import { defineRvm } from '../define.js';
import { decodePayload } from '../wire.js';

export const RVM_CHARGING_STATUS = 'charging.session.status';
export const RVM_TIME_ESTIMATION = 'charging.session.time_estimation';
export const RVM_TRIP_TARGET = 'charging.session.trip_target';
export const RVM_SOC_SLIDER = 'charging.session.soc_slider';
export const RVM_CHARGING_NOTIFICATION = 'charging.session.notification';
export const RVM_CHARGING_TIME_WINDOW = 'charging.schedule.time_window';

export interface ChargingStatus {
  /** Raw enum values; see decodeChargingStatus for those observed. */
  plugConnection: number;
  displayStatus: number;
  evseType: number;
}

/**
 * `charging.session.status` (`f70/v`): 1 plug connection status, 2 display
 * status, 3 EVSE type, all enums. Proto3 omits zeros, so missing reads as 0.
 * Seen on a home L2 charger: plug 2 while plugged in; display 5 scheduled,
 * 2 ready, 3 charging (matching chargerState); EVSE type 1. Display 4
 * matched charging_complete on October 2, 2026 at 19:01:41 UTC. Display
 * 1 is sent while unplugged, as legacy says charging_ready; it isn't read.
 */
export function decodeChargingStatus(payloadBase64: string): ChargingStatus | null {
  const m = decodePayload(payloadBase64);
  if (!m) return null;
  return {
    plugConnection: m.int(1) ?? 0,
    displayStatus: m.int(2) ?? 0,
    evseType: m.int(3) ?? 0,
  };
}

/**
 * `charging.session.time_estimation` (`g70/e0`): 1 hold time (int32
 * seconds, per the docs; not yet seen), 2 minutes remaining. Field 2 matched
 * vehicle state's timeToEndOfCharge on a live charge. Empty when not
 * charging.
 */
export function decodeTimeEstimation(
  payloadBase64: string,
): { holdTimeSeconds: number; minutesRemaining: number } | null {
  const m = decodePayload(payloadBase64);
  if (!m) return null;
  return {
    holdTimeSeconds: Math.max(0, m.int(1) ?? 0),
    minutesRemaining: Math.max(0, m.int(2) ?? 0),
  };
}

/** `charging.session.soc_slider`: 1 charge limit (%), matching batteryLimit. */
export function decodeSocSlider(payloadBase64: string): { limit: number } | null {
  const limit = decodePayload(payloadBase64)?.int(1);
  return limit != null && limit > 0 && limit <= 100 ? { limit } : null;
}

/**
 * The legacy chargerState matching a status's display status, for the
 * values seen so far (5 scheduled, 2 ready, 3 charging, 4 complete); null otherwise.
 * Parallax reports these about 30 s before vehicle state does.
 */
export function chargerStateFromStatus(status: ChargingStatus): string | null {
  return (
    { 2: 'charging_ready', 3: 'charging_active', 4: 'charging_complete', 5: 'charging_scheduled' }[
      status.displayStatus
    ] ?? null
  );
}

/**
 * The legacy chargerStatus matching a status's plug connection: 1 unplugged
 * (sent as an R2 was unplugged on October 8, 2026), 2 plugged in. Null for
 * other values. The R2 leaves legacy chargerStatus null, so this is its
 * only plug state.
 */
export function chargerStatusFromStatus(status: ChargingStatus): string | null {
  if (status.plugConnection === 1) return 'chrgr_sts_not_connected';
  if (status.plugConnection !== 2) return null;
  return status.displayStatus === 3
    ? 'chrgr_sts_connected_charging'
    : 'chrgr_sts_connected_no_chrg';
}

export const chargingStatus = defineRvm({
  rvm: RVM_CHARGING_STATUS,
  group: 'core',
  maturity: 'partial',
  decode: decodeChargingStatus,
  toState(status, timeStamp) {
    const value = chargerStatusFromStatus(status);
    return value ? { chargerStatus: { timeStamp, value } } : {};
  },
  stateKeys: ['chargerStatus'],
  store: 'log',
  fieldNames: {
    '1': 'Plug connection (enum)',
    '2': 'Display status (enum)',
    '3': 'EVSE type (enum)',
  },
});

export const timeEstimation = defineRvm({
  rvm: RVM_TIME_ESTIMATION,
  group: 'core',
  maturity: 'confirmed',
  decode: decodeTimeEstimation,
  store: 'log',
  fieldNames: {
    '1': 'Hold time (s)',
    '2': 'Minutes remaining',
  },
});

export const socSlider = defineRvm({
  rvm: RVM_SOC_SLIDER,
  group: 'core',
  maturity: 'confirmed',
  decode: decodeSocSlider,
  toState: ({ limit }, timeStamp) => ({ batteryLimit: { timeStamp, value: limit } }),
  stateKeys: ['batteryLimit'],
  store: 'log',
  fieldNames: { '1': 'Charge limit (%)' },
});

// Logged for decoding; nothing reads these yet.
export const tripTarget = defineRvm({
  rvm: RVM_TRIP_TARGET,
  group: 'core',
  maturity: 'probe',
  store: 'log',
});

export const chargingNotification = defineRvm({
  rvm: RVM_CHARGING_NOTIFICATION,
  group: 'core',
  maturity: 'probe',
  store: 'log',
});

/** A charging window, in the vehicle's local time. */
export interface ChargingWindow {
  /** 1 Sunday … 7 Saturday. */
  startDay: number;
  startMinute: number;
  endDay: number;
  endMinute: number;
  amps: number | null;
  latitude: number | null;
  longitude: number | null;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEK = 7 * 24 * 60;

/**
 * `charging.schedule.time_window`: the next charging window, sent again as
 * each one ends. 2 is the window: 1 start minute (proto3 leaves out
 * midnight), 2 end minute, 3 length in minutes, 4 amps, 5 location {1 lat,
 * 2 long}, 6/7 start and end day (1 Sunday … 7 Saturday). From an R1S whose
 * schedule (0:00–6:00 weekdays, 0:00–14:00 weekends) it matched for two
 * weeks (2026-10-13); a 1:30–6:00 window then came as 1 90, 2 360, 3 270.
 * 1 was always 1.
 */
export function decodeChargingWindow(payloadBase64: string): ChargingWindow | null {
  const window = decodePayload(payloadBase64)?.message(2);
  const startDay = window?.int(6);
  if (!window || startDay == null || startDay < 1 || startDay > 7) return null;
  const endDay = window.int(7) ?? startDay;
  const location = window.message(5);
  return {
    startDay,
    startMinute: window.int(1) ?? 0,
    endDay: endDay >= 1 && endDay <= 7 ? endDay : startDay,
    endMinute: window.int(2) ?? 0,
    amps: window.int(4),
    latitude: location?.double(1) ?? null,
    longitude: location?.double(2) ?? null,
  };
}

/** A window as a one-day schedule, for where legacy's schedules aren't available. */
export function chargingWindowSchedule(w: ChargingWindow): ChargingSchedule | null {
  const minutes =
    (((w.endDay - w.startDay + 7) % 7) * 24 * 60 + w.endMinute - w.startMinute + WEEK) % WEEK;
  if (minutes === 0) return null;
  return {
    enabled: true,
    startTime: w.startMinute,
    duration: minutes,
    amperage: w.amps,
    weekDays: [DAY_NAMES[w.startDay - 1]!],
    location: { latitude: w.latitude, longitude: w.longitude },
  };
}

export const chargingTimeWindow = defineRvm({
  rvm: RVM_CHARGING_TIME_WINDOW,
  group: 'core',
  maturity: 'partial',
  decode: decodeChargingWindow,
  store: 'log',
  fieldNames: {
    '1': 'Unknown (1 so far)',
    '2.1': 'Window: start minute',
    '2.2': 'Window: end minute',
    '2.3': 'Window: length (minutes)',
    '2.4': 'Window: amps',
    '2.5.1': 'Window: latitude',
    '2.5.2': 'Window: longitude',
    '2.6': 'Window: start day (1 Sunday … 7 Saturday)',
    '2.7': 'Window: end day',
  },
});

export const CHARGING_RVMS = [
  chargingStatus,
  timeEstimation,
  socSlider,
  tripTarget,
  chargingNotification,
  chargingTimeWindow,
] as const;
