/**
 * `energy.*` and `energy_edge_compute.*`: the high-voltage battery, and the
 * graphs the Rivian app draws (charging curve, session breakdown, cold
 * weather, parked energy). Field meanings come from community docs, checked
 * against live payloads next to the legacy vehicle state; each decoder notes
 * what's confirmed. Unknown fields are ignored.
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
 * `k70/g` graph bar: 1 SOC (int32), 2 power (float, kW), 3 start (int64 ms),
 * 4 end (int64 ms), 6 charging state. A missing power or SOC is unknown,
 * never 0: treating absence as zero put phantom 0 kW points on DC charges.
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
  };
}

/**
 * `charging_graph_global` (`k70/i`): bars repeated in field 1. Other
 * embedded messages aren't bars, even when they happen to decode as one.
 */
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
 * `charge_session_breakdown` (`k70/b`): 1 total kWh, 2 pack kWh, 5 thermal
 * kWh, 6 minutes charging, 7 minutes remaining, 8 range added (km), 9 power
 * (kW), 10 range rate (km/h), 11 cost (money). Fields 7, 9 and 10 were
 * matched against a live L2 charge (ramping to 7.4 kW, 31 km/h, 42 min left
 * matching timeToEndOfCharge); 12 and 13 are unknown enums. Rivian keeps
 * the last session's breakdown and sends it on subscribe. Confirmed against
 * a home session: 35.8 = 34.4 + 1.4 kWh, 313 min, 162 km, matching Rivian's
 * history. Missing totals read as 0 (proto3 omits zeros); missing live
 * readings (power, range rate) are unknown, never 0.
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
  /** Cell temperatures, °C; only while the vehicle is awake. */
  cellTemps: { avgC: number; maxC: number; minC: number } | null;
}

/**
 * `energy.high_voltage.battery_state` (`l70/p`): 1 charge state {1 SOC %,
 * 2 pack capacity kWh}; 2 temperature state {1 avg, 2 max, 3 min °C}.
 * SOC and capacity match the legacy batteryLevel/batteryCapacity.
 */
export function decodeBatteryState(payloadBase64: string): BatteryState | null {
  const m = decodePayload(payloadBase64);
  if (!m) return null;
  const charge = m.message(1);
  const temps = m.message(2);
  const avg = f32(temps?.float(1) ?? null);
  const max = f32(temps?.float(2) ?? null);
  const min = f32(temps?.float(3) ?? null);
  return {
    soc: f32(charge?.double(1) ?? null),
    capacityKwh: f32(charge?.double(2) ?? null),
    cellTemps:
      avg != null && max != null && min != null ? { avgC: avg, maxC: max, minC: min } : null,
  };
}

/**
 * `battery_characteristics`: field 5 is the reported capacity estimate;
 * field 6 is rated capacity (both float, kWh; field 6 identified by the owner).
 * Decode independently: a missing rated value must not use the estimate.
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
 * `parked_energy_distributions` (`k70/o`): repeated windows {1 total kWh,
 * 2–5 kWh by use, 6 total range km, 7–10 range by use, 11 window length in
 * minutes}. Uses: 2 climate, 3 outlets, 4 system, 5 Gear Guard. An outlet-use
 * capture on 2026-10-04 identifies field 3 (0.1 kWh), with field 5 omitted.
 * 1440- and 480-minute windows drain at the same rate, which supports
 * reading 11 as minutes.
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
  maturity: 'confirmed',
  decode: decodeChargingGraph,
  store: true,
  fieldNames: {
    '1.1': 'Bar: SOC (%)',
    '1.2': 'Bar: power (kW)',
    '1.3': 'Bar: start (ms since epoch)',
    '1.4': 'Bar: end (ms since epoch)',
    '1.6': 'Bar: charging state',
  },
});

export const chargeBreakdown = defineRvm({
  rvm: RVM_CHARGE_BREAKDOWN,
  group: 'core',
  maturity: 'confirmed',
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
  },
});

export const coldWeather = defineRvm({
  rvm: RVM_COLD_WEATHER,
  group: 'core',
  maturity: 'confirmed',
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
  maturity: 'confirmed',
  decode: decodeParkedEnergy,
  store: true,
  fieldNames: {
    '*.1': 'Window: total energy (kWh)',
    '*.2': 'Window: climate (kWh)',
    '*.3': 'Window: outlets (kWh)',
    '*.4': 'Window: system (kWh)',
    '*.5': 'Window: Gear Guard (kWh)',
    '*.6': 'Window: total range (km)',
    '*.11': 'Window: length (minutes)',
  },
});

/** SOC and pack capacity, as legacy batteryLevel and batteryCapacity. */
export const batteryState = defineRvm({
  rvm: RVM_BATTERY_STATE,
  group: 'core',
  maturity: 'confirmed',
  decode: decodeBatteryState,
  toState: (battery, timeStamp) =>
    stampReadings(
      readings((put) => {
        const { soc, capacityKwh } = battery;
        if (soc != null && soc >= 0 && soc <= 100) put('batteryLevel', soc);
        if (capacityKwh != null && capacityKwh > 0 && capacityKwh <= 500) {
          put('batteryCapacity', capacityKwh);
        }
      }) ?? {},
      timeStamp,
    ),
  stateKeys: ['batteryLevel', 'batteryCapacity'],
  store: true,
  fieldNames: {
    '1.1': 'SOC (%)',
    '1.2': 'Pack capacity (kWh)',
    '2.1': 'Cell temperature, average (°C)',
    '2.2': 'Cell temperature, max (°C)',
    '2.3': 'Cell temperature, min (°C)',
  },
});

export const batteryCharacteristics = defineRvm({
  rvm: RVM_BATTERY_CHARACTERISTICS,
  group: 'core',
  maturity: 'partial',
  decode: decodeBatteryCharacteristics,
  store: true,
  fieldNames: {
    '5': 'Capacity estimate (kWh)',
    '6': 'Rated capacity (kWh)',
  },
});

// Legacy's spelling for normal; low hasn't been seen from legacy, so it's
// named in the same style.
const TWELVE_VOLT_HEALTH: Record<number, string> = { 1: 'NORMAL_OPERATION', 2: 'LOW' };

/**
 * `energy.low_voltage.battery_state`: 1 12V battery health (1 normal, 2
 * low; only 1 seen so far), as legacy twelveVoltBatteryHealth.
 */
export const lowVoltageBattery = defineRvm({
  rvm: RVM_LOW_VOLTAGE_BATTERY,
  group: 'vehicleState',
  maturity: 'confirmed',
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
