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
 * Seen on a home L2 charger: plug 1 unplugged, 2 plugged in; display
 * statuses as chargerStateFromStatus reads them; EVSE type 1.
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
 * `charging.session.time_estimation` (`g70/e0`): 1 whether the estimate
 * holds (1 valid, 2 not, 3 the pack is discharging; 0 none), 2 minutes
 * remaining. Field 2 matched vehicle state's timeToEndOfCharge on a live
 * charge. Empty when not charging.
 */
export function decodeTimeEstimation(
  payloadBase64: string,
): { validity: number; minutesRemaining: number } | null {
  const m = decodePayload(payloadBase64);
  if (!m) return null;
  return {
    validity: m.int(1) ?? 0,
    minutesRemaining: Math.max(0, m.int(2) ?? 0),
  };
}

/** `charging.session.soc_slider`: 1 charge limit (%), matching batteryLimit. */
export function decodeSocSlider(payloadBase64: string): { limit: number } | null {
  const limit = decodePayload(payloadBase64)?.int(1);
  return limit != null && limit > 0 && limit <= 100 ? { limit } : null;
}

/**
 * Display statuses as legacy chargerState: 2 connecting, 3 charging, 4
 * complete (October 2, 2026), 5 scheduled, 8 stopped from the app, each
 * seen beside legacy; 2 and 8 matched it each time on an R1S (2 of 2,
 * 2026-10-13). The rest haven't been sent yet, so they're named after the
 * Rivian app's states in legacy's style.
 */
const CHARGER_STATES: Record<number, string> = {
  2: 'charging_connecting',
  3: 'charging_active',
  4: 'charging_complete',
  5: 'charging_scheduled',
  6: 'charging_vehicle_error',
  7: 'charging_station_error',
  8: 'charging_user_stopped',
  9: 'charging_station_stopped',
  10: 'charging_payment_error',
  11: 'charging_cert_error',
  12: 'charging_tls_error',
  13: 'charging_error_ac_adapter_used_on_dc',
  14: 'charging_error_dc_adapter_used_on_ac',
  15: 'charging_error_incompatible_charger',
  16: 'charging_sd_compensation',
  17: 'charging_waiting_on_charger',
  18: 'charging_charger_not_ready_or_incompatible',
  19: 'charging_vehicle_stopped',
  20: 'charging_payment_error_start_rivian_app',
  21: 'charging_tls_error_unknown_charger',
  22: 'charging_tls_error_unexpected_fail',
  23: 'charging_tls_error_start_rivian_app',
  24: 'charging_smart_charging_paused',
  25: 'charging_smart_charging_active',
};

/**
 * The legacy chargerState matching a status's display status (see
 * CHARGER_STATES). 1 is ready only while unplugged, as legacy reports it:
 * sent just after plugging in, legacy says connecting or scheduled instead,
 * so it's left unread then. Null for other values. Parallax reports these
 * about 30 s before vehicle state does.
 */
export function chargerStateFromStatus(status: ChargingStatus): string | null {
  if (status.displayStatus === 1) return status.plugConnection === 1 ? 'charging_ready' : null;
  return CHARGER_STATES[status.displayStatus] ?? null;
}

/**
 * The legacy chargerStatus matching a status's plug connection: 1 unplugged
 * (sent as an R2 was unplugged on October 8, 2026), 2 plugged in. Null for
 * the others, 3 a connection error and 4 a vehicle-to-load adapter: legacy
 * has no value for either, and plugged in would start a charging session.
 * The R2 leaves legacy chargerStatus null, so this is its only plug state.
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
  // Both plug and charger state, as the R2 leaves legacy's null.
  toState(status, timeStamp) {
    const plug = chargerStatusFromStatus(status);
    const charger = chargerStateFromStatus(status);
    return {
      ...(plug ? { chargerStatus: { timeStamp, value: plug } } : {}),
      ...(charger ? { chargerState: { timeStamp, value: charger } } : {}),
    };
  },
  stateKeys: ['chargerStatus', 'chargerState'],
  store: true,
  fieldNames: {
    '1': 'Plug (1 unplugged, 2 plugged in, 3 error, 4 vehicle-to-load)',
    '2': 'Charging state (1 ready, 2 connecting, 3 charging, 4 complete, 5 scheduled, 8 stopped…)',
    '3': 'EVSE type (enum; 1 on a charger)',
  },
});

export const timeEstimation = defineRvm({
  rvm: RVM_TIME_ESTIMATION,
  group: 'core',
  maturity: 'confirmed',
  decode: decodeTimeEstimation,
  store: true,
  fieldNames: {
    '1': 'Estimate (1 valid, 2 not, 3 pack discharging)',
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
  store: true,
  fieldNames: { '1': 'Charge limit (%)' },
});

// Logged for decoding; nothing reads these yet.
export const tripTarget = defineRvm({
  rvm: RVM_TRIP_TARGET,
  group: 'core',
  maturity: 'probe',
  store: true,
  fieldNames: { '2': 'Trip target SOC (%; 65535 none)' },
});

export const chargingNotification = defineRvm({
  rvm: RVM_CHARGING_NOTIFICATION,
  group: 'core',
  maturity: 'probe',
  store: true,
  fieldNames: {
    '1': 'Unexpected stop reason',
    '2': 'Power limited by (1 warm adapter, 2/3 warm DC/AC plug, 4 charger, 5 nearly full, 7 climate, 8 heating, 9 cooling, 10–14 battery temperature…)',
    '3': 'Fault (1 charging disabled, 2 DC disabled, 5 DC reduced, 6 AC disabled, 8 AC reduced, 9 partial connection, 10 not in park…)',
  },
});

/** A charging window, in the vehicle's local time. */
export interface ChargingWindow {
  /** 1 Sunday … 7 Saturday. */
  startDay: number;
  startMinute: number;
  endDay: number;
  endMinute: number;
  /** Its length, as Rivian sends it; a week (or more) for a window that never closes. */
  minutes: number | null;
  amps: number | null;
  latitude: number | null;
  longitude: number | null;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEK = 7 * 24 * 60;

/**
 * `charging.schedule.time_window`: the next charging window, sent again as
 * each one ends. 1 whether a schedule is set (always 1 so far; empty with
 * none); 2 is the window: 1 start minute (proto3 leaves out midnight), 2 end
 * minute, 3 length in minutes (10080 for a window covering the whole week),
 * 4 amps, 5 location {1 lat, 2 long}, 6/7 start and end day (1 Sunday … 7
 * Saturday). From an R1S whose schedule (0:00–6:00 weekdays, 0:00–14:00
 * weekends) it matched for two weeks (2026-10-13); a 1:30–6:00 window then
 * came as 1 90, 2 360, 3 270.
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
    minutes: window.int(3),
    amps: window.int(4),
    latitude: location?.double(1) ?? null,
    longitude: location?.double(2) ?? null,
  };
}

/**
 * A window as a one-day schedule, for where legacy's schedules aren't
 * available. A window covering the whole week, whose start and end are the
 * same, is charging all day, every day.
 */
export function chargingWindowSchedule(w: ChargingWindow): ChargingSchedule | null {
  const location = { latitude: w.latitude, longitude: w.longitude };
  if (w.minutes != null && w.minutes >= WEEK) {
    return {
      enabled: true,
      startTime: 0,
      duration: 24 * 60,
      amperage: w.amps,
      weekDays: [...DAY_NAMES],
      location,
    };
  }
  const minutes =
    (((w.endDay - w.startDay + 7) % 7) * 24 * 60 + w.endMinute - w.startMinute + WEEK) % WEEK;
  if (minutes === 0) return null;
  return {
    enabled: true,
    startTime: w.startMinute,
    duration: minutes,
    amperage: w.amps,
    weekDays: [DAY_NAMES[w.startDay - 1]!],
    location,
  };
}

export const chargingTimeWindow = defineRvm({
  rvm: RVM_CHARGING_TIME_WINDOW,
  group: 'core',
  maturity: 'partial',
  decode: decodeChargingWindow,
  store: true,
  fieldNames: {
    '1': 'Schedule set',
    '2.1': 'Window: start minute',
    '2.2': 'Window: end minute',
    '2.3': 'Window: length (minutes; 10080 all week)',
    '2.4': 'Window: amps',
    '2.5.1': 'Window: latitude',
    '2.5.2': 'Window: longitude',
    '2.6': 'Window: start day (1 Sunday … 7 Saturday)',
    '2.7': 'Window: end day',
  },
});

// Probes: subscribed and archived, so their fields can be checked against
// live data before anything reads them. Field meanings are the Rivian
// app's, not yet seen.
export const sessionPower = defineRvm({
  rvm: 'charging.session.power',
  group: 'core',
  maturity: 'probe',
  store: true,
  fieldNames: { '1': 'Power (kW, about every 5 s; not resent as 0 when a charge ends)' },
});

export const remoteCommand = defineRvm({
  rvm: 'charging.session.remote_command',
  group: 'core',
  maturity: 'probe',
  store: true,
  fieldNames: { '1': 'Charge now available (1 no, 2 yes)' },
});

export const chargingEnergyState = defineRvm({
  rvm: 'charging.energy.state',
  group: 'core',
  maturity: 'probe',
  store: true,
  fieldNames: {
    '1': 'Charging state (as the session status)',
    '2': 'Plug (1 unplugged, 2 plugged in, 3 charging)',
    '4': 'Power (kW)',
    '11': 'Plug connection (as the session status)',
  },
});

export const smartChargingSettings = defineRvm({
  rvm: 'charging.smart_charging.settings',
  group: 'core',
  maturity: 'probe',
  store: true,
  fieldNames: {
    '1.1': 'Ready by: hour',
    '1.2': 'Ready by: minute',
    '1.3': 'Ready by: days (1 Monday … 7 Sunday)',
    '2': 'Clean energy',
  },
});

export const smartChargingInfo = defineRvm({
  rvm: 'charging.smart_charging.smart_charging_info',
  group: 'core',
  maturity: 'probe',
  store: true,
  fieldNames: {
    '1.1': 'Resumes (s since epoch)',
    '2': 'Notice (1 clean energy, 2 paused, 3 not enough time, 4 no forecast)',
    '3': 'Schedule type',
  },
});

export const chargingForecast = defineRvm({
  rvm: 'charging.smart_charging.weighted_charging_forecast',
  group: 'core',
  maturity: 'probe',
  store: true,
});

export const CHARGING_RVMS = [
  chargingStatus,
  timeEstimation,
  socSlider,
  tripTarget,
  chargingNotification,
  chargingTimeWindow,
  sessionPower,
  remoteCommand,
  chargingEnergyState,
  smartChargingSettings,
  smartChargingInfo,
  chargingForecast,
] as const;
