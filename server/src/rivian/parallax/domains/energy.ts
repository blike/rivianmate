/**
 * `energy.*` and `energy_edge_compute.*`: the batteries, and the graphs the
 * Rivian app draws (charging curve, session breakdown, cold weather, parked
 * energy).
 */
import { defineRvm, fieldsOrEmpty, readings, stampReadings } from '../define.js';
import { decodePayload, f32, readProtoFields, type ProtoField } from '../wire.js';

export const RVM_CHARGING_GRAPH = 'energy_edge_compute.graphs.charging_graph_global';
export const RVM_CHARGE_BREAKDOWN = 'energy_edge_compute.graphs.charge_session_breakdown';
export const RVM_COLD_WEATHER = 'energy_edge_compute.graphs.cold_weather_soc';
export const RVM_PARKED_ENERGY = 'energy_edge_compute.graphs.parked_energy_distributions';
export const RVM_BATTERY_STATE = 'energy.high_voltage.battery_state';
export const RVM_BATTERY_CHARACTERISTICS = 'energy.high_voltage.battery_characteristics';
export const RVM_LOW_VOLTAGE_BATTERY = 'energy.low_voltage.battery_state';

export interface ChargingGraphBar {
  soc: number | null;
  /** Null when the bar carries no power reading. */
  powerKw: number | null;
  startMs: number;
  endMs: number | null;
  chargingState: number | null;
  /** 0 a recorded bar, 1 a forecast, 2 not charging, 3 paused. */
  context: number;
}

/** Bars plausibly from this century; guards against misreading other fields. */
const MIN_MS = Date.UTC(2015, 0, 1);
const MAX_MS = Date.UTC(2100, 0, 1);

/** Readings outside these ranges are misreads, not data. */
const MAX_POWER_KW = 500;
const validSoc = (n: number | null) => (n != null && n >= 0 && n <= 100 ? n : null);
/** In range, with float32 noise rounded off (124.7 arrives as 124.69999…). */
const validPower = (n: number | null) =>
  n != null && Number.isFinite(n) && n >= 0 && n <= MAX_POWER_KW
    ? Math.round(n * 1000) / 1000
    : null;

/**
 * A graph bar: 1 SOC, 2 power (kW), 3/4 start and end (ms), 5 estimate
 * validity, 6 charging state, 7 context (0 recorded, 1 forecast, 2 not
 * charging, 3 paused). A missing power or SOC is unknown, never 0.
 */
export function decodeChargingGraphBar(bytes: Uint8Array): ChargingGraphBar | null {
  const fields = readProtoFields(bytes);
  if (!fields) return null;
  const get = (n: number) => fields.find((f) => f.field === n);
  const start = get(3);
  if (start?.wire !== 0) return null;
  const startMs = Number(start.value);
  if (startMs < MIN_MS || startMs > MAX_MS) return null;

  const soc = get(1);
  const power = get(2);
  const end = get(4);
  const state = get(6);
  const context = get(7);
  return {
    soc: validSoc(soc?.wire === 0 ? Number(BigInt.asIntN(32, soc.value)) : null),
    powerKw: validPower(
      power?.wire === 5
        ? new DataView(power.value.buffer, power.value.byteOffset, 4).getFloat32(0, true)
        : null,
    ),
    startMs,
    endMs: end?.wire === 0 && Number(end.value) >= startMs ? Number(end.value) : null,
    chargingState: state?.wire === 0 ? Number(state.value) : null,
    context: context?.wire === 0 ? Number(context.value) : 0,
  };
}

/** `charging_graph_global`: bars repeated in field 1; other messages aren't bars. */
export function decodeChargingGraph(payloadBase64: string): ChargingGraphBar[] {
  if (!payloadBase64) return [];
  const fields = readProtoFields(Buffer.from(payloadBase64, 'base64'));
  if (!fields) return [];
  return fields
    .filter((f): f is ProtoField & { wire: 2 } => f.field === 1 && f.wire === 2)
    .map((f) => decodeChargingGraphBar(f.value))
    .filter((bar): bar is ChargingGraphBar => bar !== null)
    .sort((a, b) => a.startMs - b.startMs);
}

export interface ChargeBreakdown {
  totalKwh: number;
  /** Energy stored in the pack, and energy spent heating or cooling it. */
  packKwh: number;
  thermalKwh: number;
  chargingMinutes: number;
  rangeAddedKm: number | null;
  cost: { amount: number; currency: string } | null;
  /** Live readings, updated every few seconds; stale once charging stops. Null when absent. */
  powerKw: number | null;
  rangeKmPerHour: number | null;
  minutesRemaining: number;
}

/**
 * `charge_session_breakdown`: 1 total kWh, 2 pack kWh, 5 thermal kWh, 6
 * minutes charging, 7 minutes remaining, 8 range added (km), 9 power (kW),
 * 10 range rate (km/h), 11 cost. Field 5 is likely the vehicle's systems,
 * not heating, which the app's schema puts in 3. Rivian resends the last
 * session's on subscribe. Missing totals are 0; missing live readings are
 * unknown.
 */
export function decodeChargeBreakdown(payloadBase64: string): ChargeBreakdown | null {
  const m = decodePayload(payloadBase64);
  if (!m) return null;
  const totalKwh = f32(m.float(1)) ?? 0;
  const packKwh = f32(m.float(2)) ?? 0;
  const thermalKwh = f32(m.float(5)) ?? 0;
  if (totalKwh < 0 || packKwh < 0 || thermalKwh < 0) return null;
  const money = m.message(11);
  const units = money?.int(2) ?? 0;
  const nanos = money?.int(3) ?? 0;
  const currency = money?.string(1) || null;
  return {
    totalKwh,
    packKwh,
    thermalKwh,
    chargingMinutes: Math.max(0, m.int(6) ?? 0),
    rangeAddedKm: m.int(8),
    cost: currency ? { amount: units + nanos / 1e9, currency } : null,
    powerKw: validPower(f32(m.float(9))),
    rangeKmPerHour: (() => {
      const rate = m.int(10);
      return rate != null && rate >= 0 ? rate : null;
    })(),
    minutesRemaining: Math.max(0, m.int(7) ?? 0),
  };
}

export interface BatteryState {
  soc: number | null;
  capacityKwh: number | null;
  /** Whether a thermal event is detected; null when not sent. */
  thermalEvent: boolean | null;
  /** Cell temperatures, °C; only while the vehicle is awake. */
  cellTemps: { avgC: number; maxC: number; minC: number } | null;
}

/**
 * `energy.high_voltage.battery_state`: 1 charge {1 SOC %, 2 capacity kWh},
 * 2 cell temperatures {1 avg, 2 max, 3 min °C}, 3 thermal event {1
 * detected, 2 spreading; empty when none}, 4 power output, 5 LFP
 * calibration, 6 BMS state.
 */
export function decodeBatteryState(payloadBase64: string): BatteryState | null {
  const m = decodePayload(payloadBase64);
  if (!m) return null;
  const charge = m.message(1);
  const temps = m.message(2);
  const thermal = m.message(3);
  const avg = f32(temps?.float(1) ?? null);
  const max = f32(temps?.float(2) ?? null);
  const min = f32(temps?.float(3) ?? null);
  return {
    soc: f32(charge?.double(1) ?? null),
    capacityKwh: f32(charge?.double(2) ?? null),
    thermalEvent: thermal ? thermal.int(1) === 1 || thermal.int(2) === 1 : null,
    cellTemps:
      avg != null && max != null && min != null ? { avgC: avg, maxC: max, minC: min } : null,
  };
}

/**
 * `battery_characteristics`: 5 capacity estimate, 6 rated capacity (kWh),
 * read independently so a missing rating never falls back to the estimate.
 */
export function decodeBatteryCharacteristics(
  payloadBase64: string,
): { capacityKwh: number | null; ratedCapacityKwh: number | null } | null {
  const fields = decodePayload(payloadBase64);
  const capacity = (field: number) => {
    const value = fields?.float(field);
    return value != null && Number.isFinite(value) && value > 0 && value <= 500 ? f32(value) : null;
  };
  const capacityKwh = capacity(5);
  const ratedCapacityKwh = capacity(6);
  return capacityKwh != null || ratedCapacityKwh != null ? { capacityKwh, ratedCapacityKwh } : null;
}

export interface ColdWeather {
  /** Battery % usable now, % held back by the cold, and range lost (km). */
  usableSoc: number | null;
  coldSoc: number;
  rangeImpactKm: number;
}

/** `cold_weather_soc` (`k70/k`): 1 usable SOC %, 2 cold-limited SOC %, 3 range impact km. */
export function decodeColdWeather(payloadBase64: string): ColdWeather | null {
  const m = decodePayload(payloadBase64);
  if (!m) return null;
  const num = (n: number) => m.int(n) ?? f32(m.float(n));
  return { usableSoc: num(1), coldSoc: num(2) ?? 0, rangeImpactKm: num(3) ?? 0 };
}

export interface ParkedEnergyWindow {
  minutes: number;
  kwh: number;
  rangeKm: number;
  /** Where the energy went, kWh. */
  uses: { climate: number; system: number; gearGuard: number; outlets: number };
}

/**
 * `parked_energy_distributions`: windows (1 last 24 h, 2 last 8 h, 3 this
 * park) of {1 total kWh, 2–5 kWh by use (climate, outlets, system, Gear
 * Guard), 6 total range km, 7–10 range by use, 11 length in minutes}.
 */
export function decodeParkedEnergy(payloadBase64: string): ParkedEnergyWindow[] {
  const m = decodePayload(payloadBase64);
  if (!m) return [];
  const windows: ParkedEnergyWindow[] = [];
  for (const field of [1, 2, 3, 4]) {
    const w = m.message(field);
    const minutes = w?.int(11);
    if (!w || !minutes || minutes <= 0) continue;
    const kwh = (n: number) => f32(w.float(n)) ?? 0;
    windows.push({
      minutes,
      kwh: kwh(1),
      rangeKm: kwh(6),
      uses: { climate: kwh(2), system: kwh(4), gearGuard: kwh(5), outlets: kwh(3) },
    });
  }
  return windows;
}

export const chargingGraph = defineRvm({
  rvm: RVM_CHARGING_GRAPH,
  group: 'core',
  decode: decodeChargingGraph,
  store: true,
  fieldNames: {
    '1.1': 'Bar: SOC (%)',
    '1.2': 'Bar: power (kW)',
    '1.3': 'Bar: start (ms since epoch)',
    '1.4': 'Bar: end (ms since epoch)',
    '1.5': 'Bar: estimate (1 pack discharging, 2 not valid, 3 valid)',
    '1.6': 'Bar: charging state',
    '1.7': 'Bar: context (1 forecast, 2 not charging, 3 paused)',
  },
});

export const chargeBreakdown = defineRvm({
  rvm: RVM_CHARGE_BREAKDOWN,
  group: 'core',
  decode: decodeChargeBreakdown,
  store: true,
  fieldNames: {
    '1': 'Total energy (kWh)',
    '2': 'Energy into the pack (kWh)',
    '5': 'Energy for heating/cooling (kWh)',
    '6': 'Minutes charging',
    '7': 'Minutes remaining',
    '8': 'Range added (km)',
    '9': 'Power (kW)',
    '10': 'Range rate (km/h)',
    '11.1': 'Cost: currency',
    '11.2': 'Cost: whole units',
    '11.3': 'Cost: nanos',
    '12': 'Free session',
    '13': 'Charging state (as the session status)',
  },
});

export const coldWeather = defineRvm({
  rvm: RVM_COLD_WEATHER,
  group: 'core',
  decode: decodeColdWeather,
  store: true,
  fieldNames: {
    '1': 'Usable SOC (%)',
    '2': 'SOC held back by cold (%)',
    '3': 'Range lost to cold (km)',
  },
});

export const parkedEnergy = defineRvm({
  rvm: RVM_PARKED_ENERGY,
  group: 'core',
  decode: decodeParkedEnergy,
  store: true,
  fieldNames: {
    '*.1': 'Window: total energy (kWh)',
    '*.2': 'Window: climate (kWh)',
    '*.3': 'Window: outlets (kWh)',
    '*.4': 'Window: system (kWh)',
    '*.5': 'Window: Gear Guard (kWh)',
    '*.6': 'Window: total range (km)',
    '*.7': 'Window: climate range (km)',
    '*.8': 'Window: outlets range (km)',
    '*.9': 'Window: system range (km)',
    '*.10': 'Window: Gear Guard range (km)',
    '*.11': 'Window: length (minutes)',
  },
});

/** SOC and pack capacity, as legacy batteryLevel and batteryCapacity. */
export const batteryState = defineRvm({
  rvm: RVM_BATTERY_STATE,
  group: 'core',
  decode: decodeBatteryState,
  toState: (battery, timeStamp) =>
    stampReadings(
      readings((put) => {
        const { soc, capacityKwh } = battery;
        if (soc != null && soc >= 0 && soc <= 100) put('batteryLevel', soc);
        if (capacityKwh != null && capacityKwh > 0 && capacityKwh <= 500) {
          put('batteryCapacity', capacityKwh);
        }
        // Legacy's spelling for none is off; on is in its style.
        if (battery.thermalEvent != null) {
          put('batteryHvThermalEvent', battery.thermalEvent ? 'on' : 'off');
        }
      }) ?? {},
      timeStamp,
    ),
  stateKeys: ['batteryLevel', 'batteryCapacity', 'batteryHvThermalEvent'],
  store: true,
  fieldNames: {
    '1.1': 'SOC (%)',
    '1.2': 'Pack capacity (kWh)',
    '2.1': 'Cell temperature, average (°C)',
    '2.2': 'Cell temperature, max (°C)',
    '2.3': 'Cell temperature, min (°C)',
    '3.1': 'Thermal event detected',
    '3.2': 'Thermal event spreading',
    '4': 'Power output (1 normal, 2 limited by cold)',
    '5': 'LFP calibration needed',
    '6': 'BMS state (4 idle, 5 discharging, 6 charging)',
  },
});

export const batteryCharacteristics = defineRvm({
  rvm: RVM_BATTERY_CHARACTERISTICS,
  group: 'core',
  decode: decodeBatteryCharacteristics,
  store: true,
  fieldNames: {
    '1': 'Cell chemistry (1 NCA, 2 LFP, 3 NMC)',
    '2': 'Cell type (1 50G, 2 53G, 3 G124, 4 LG 4695)',
    '3': 'Module type',
    '4': 'Pack (1 135, 2 150, 3 100, 4 116, 5 108, 6 88 kWh)',
    '5': 'Capacity estimate (kWh)',
    '6': 'Rated capacity (kWh)',
  },
});

// Legacy's spelling for normal; low is in its style.
const TWELVE_VOLT_HEALTH: Record<number, string> = { 1: 'NORMAL_OPERATION', 2: 'LOW' };

/** `energy.low_voltage.battery_state`: 1 12V health (1 normal, 2 low), as legacy's. */
export const lowVoltageBattery = defineRvm({
  rvm: RVM_LOW_VOLTAGE_BATTERY,
  group: 'vehicleState',
  decode: (payload) =>
    readings((put) =>
      put('twelveVoltBatteryHealth', TWELVE_VOLT_HEALTH[fieldsOrEmpty(payload)?.int(1) ?? 0]),
    ),
  toState: stampReadings,
  stateKeys: ['twelveVoltBatteryHealth'],
  store: true,
  fieldNames: { '1': '12V battery health (1 normal, 2 low)' },
});

export const ENERGY_RVMS = [
  chargingGraph,
  chargeBreakdown,
  coldWeather,
  parkedEnergy,
  batteryState,
  batteryCharacteristics,
  lowVoltageBattery,
] as const;
