/**
 * Parallax: Rivian's newer vehicle data feed. It shares the GraphQL
 * WebSocket with the legacy subscriptions, but each message carries a
 * base64 protobuf for one topic ("RVM"). There are no public .proto files;
 * field numbers come from community docs (rivian-api.kaedenb.org), so
 * decoding here is defensive: anything unexpected is skipped, never thrown.
 */

/** Live charging graph: the bars the Rivian app draws for a session. */
export const RVM_CHARGING_GRAPH = "energy_edge_compute.graphs.charging_graph_global";

/** Topics a charging capture records (the app's charging subscribe list). */
export const PARALLAX_CHARGING_RVMS: readonly string[] = [
  RVM_CHARGING_GRAPH,
  "energy_edge_compute.graphs.charge_session_breakdown",
  "energy_edge_compute.graphs.cold_weather_soc",
  "energy.high_voltage.battery_state",
  "energy.high_voltage.battery_characteristics",
  "charging.session.status",
  "charging.session.time_estimation",
  "charging.session.trip_target",
  "charging.session.soc_slider",
  "charging.session.notification",
  "charging.schedule.time_window",
];

export interface ParallaxMessage {
  rvm: string;
  /** Base64 protobuf; empty for a keepalive or cleared state. */
  payload: string;
  timestamp: number | null;
}

type WireValue =
  | { wire: 0; value: bigint }
  | { wire: 1; value: Uint8Array }
  | { wire: 2; value: Uint8Array }
  | { wire: 5; value: Uint8Array };

export type ProtoField = { field: number } & WireValue;

/** Protobuf wire-format fields, or null if the bytes aren't valid protobuf. */
export function readProtoFields(bytes: Uint8Array): ProtoField[] | null {
  const fields: ProtoField[] = [];
  let pos = 0;
  const varint = (): bigint | null => {
    let result = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
      if (pos >= bytes.length) return null;
      const byte = bytes[pos++]!;
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result;
    }
    return null;
  };
  const take = (n: number): Uint8Array | null => {
    if (n < 0 || pos + n > bytes.length) return null;
    const out = bytes.subarray(pos, pos + n);
    pos += n;
    return out;
  };

  while (pos < bytes.length) {
    const key = varint();
    if (key === null) return null;
    const field = Number(key >> 3n);
    const wire = Number(key & 7n);
    if (field === 0) return null;
    if (wire === 0) {
      const value = varint();
      if (value === null) return null;
      fields.push({ field, wire, value });
    } else if (wire === 1 || wire === 5) {
      const value = take(wire === 1 ? 8 : 4);
      if (value === null) return null;
      fields.push({ field, wire, value });
    } else if (wire === 2) {
      const length = varint();
      if (length === null) return null;
      const value = take(Number(length));
      if (value === null) return null;
      fields.push({ field, wire, value });
    } else {
      return null; // groups (3/4) and reserved types aren't used here
    }
  }
  return fields;
}

export interface ChargingGraphBar {
  soc: number | null;
  powerKw: number;
  startMs: number;
  endMs: number | null;
  chargingState: number | null;
}

/** Bars plausibly from this century; guards against misreading other fields. */
const MIN_MS = Date.UTC(2015, 0, 1);
const MAX_MS = Date.UTC(2100, 0, 1);

/**
 * `k70/g` graph bar: 1 SOC (int32), 2 power (float, kW), 3 start (int64 ms),
 * 4 end (int64 ms), 6 charging state. Proto3 omits zero values, so a
 * missing power is 0 kW; a missing SOC is unknown.
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
    soc: soc?.wire === 0 ? Number(BigInt.asIntN(32, soc.value)) : null,
    powerKw:
      power?.wire === 5
        ? new DataView(power.value.buffer, power.value.byteOffset, 4).getFloat32(0, true)
        : 0,
    startMs,
    endMs: end?.wire === 0 && Number(end.value) >= startMs ? Number(end.value) : null,
    chargingState: state?.wire === 0 ? Number(state.value) : null,
  };
}

/**
 * `charging_graph_global` (`k70/i`): repeated graph bars. The repeated
 * field's number isn't documented, so every embedded message that decodes
 * as a bar is taken.
 */
export function decodeChargingGraph(payloadBase64: string): ChargingGraphBar[] {
  if (!payloadBase64) return [];
  const fields = readProtoFields(Buffer.from(payloadBase64, "base64"));
  if (!fields) return [];
  return fields
    .filter((f): f is ProtoField & { wire: 2 } => f.wire === 2)
    .map((f) => decodeChargingGraphBar(f.value))
    .filter((bar): bar is ChargingGraphBar => bar !== null)
    .sort((a, b) => a.startMs - b.startMs);
}

// ---------------------------------------------------------------------------
// Insight topics. Field meanings come from community docs, checked against
// live payloads next to the legacy vehicle state; each decoder notes what's
// confirmed. Unknown fields are ignored.

export const RVM_CHARGE_BREAKDOWN = "energy_edge_compute.graphs.charge_session_breakdown";
export const RVM_BATTERY_STATE = "energy.high_voltage.battery_state";
export const RVM_COLD_WEATHER = "energy_edge_compute.graphs.cold_weather_soc";
export const RVM_PARKED_ENERGY = "energy_edge_compute.graphs.parked_energy_distributions";
export const RVM_NETWORK = "vehicle.network.state";
export const RVM_TRIP_INFO = "navigation.navigation_service.trip_info";
export const RVM_TRIP_PROGRESS = "navigation.navigation_service.trip_progress";

// Charging topics recorded while their formats are worked out. Only status
// and time estimation have documented fields.
export const RVM_BATTERY_CHARACTERISTICS = "energy.high_voltage.battery_characteristics";
export const RVM_CHARGING_STATUS = "charging.session.status";
export const RVM_TIME_ESTIMATION = "charging.session.time_estimation";
export const RVM_TRIP_TARGET = "charging.session.trip_target";
export const RVM_SOC_SLIDER = "charging.session.soc_slider";
export const RVM_CHARGING_NOTIFICATION = "charging.session.notification";
export const RVM_CHARGING_TIME_WINDOW = "charging.schedule.time_window";

/**
 * Topics whose every distinct payload is logged, not just the latest, so
 * their fields can be decoded against how they change during a charge.
 */
export const PARALLAX_LOGGED_RVMS: readonly string[] = [
  RVM_CHARGE_BREAKDOWN,
  RVM_BATTERY_CHARACTERISTICS,
  RVM_CHARGING_STATUS,
  RVM_TIME_ESTIMATION,
  RVM_TRIP_TARGET,
  RVM_SOC_SLIDER,
  RVM_CHARGING_NOTIFICATION,
  RVM_CHARGING_TIME_WINDOW,
];

/** Topics the monitor subscribes to. */
export const PARALLAX_MONITOR_RVMS: readonly string[] = [
  RVM_CHARGING_GRAPH,
  RVM_BATTERY_STATE,
  RVM_COLD_WEATHER,
  RVM_PARKED_ENERGY,
  RVM_NETWORK,
  RVM_TRIP_INFO,
  RVM_TRIP_PROGRESS,
  ...PARALLAX_LOGGED_RVMS,
];

/** Field accessors over one decoded message; wrong wire types read as absent. */
function fieldsOf(bytes: Uint8Array | null | undefined) {
  const fields = bytes ? readProtoFields(bytes) : null;
  if (!fields) return null;
  const find = (n: number) => fields.find((f) => f.field === n);
  const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
  return {
    float(n: number): number | null {
      const f = find(n);
      return f?.wire === 5 ? view(f.value).getFloat32(0, true) : null;
    },
    double(n: number): number | null {
      const f = find(n);
      return f?.wire === 1 ? view(f.value).getFloat64(0, true) : null;
    },
    /** Signed varint (int32/int64 two's complement). */
    int(n: number): number | null {
      const f = find(n);
      return f?.wire === 0 ? Number(BigInt.asIntN(64, f.value)) : null;
    },
    string(n: number): string | null {
      const f = find(n);
      return f?.wire === 2 ? new TextDecoder().decode(f.value) : null;
    },
    message(n: number) {
      const f = find(n);
      return f?.wire === 2 ? fieldsOf(f.value) : null;
    },
  };
}

const decode = (payloadBase64: string) =>
  payloadBase64 ? fieldsOf(Buffer.from(payloadBase64, "base64")) : null;

/** Rounds float32 noise (34.4 arrives as 34.400001…). */
const f32 = (n: number | null) => (n == null ? null : Math.round(n * 1000) / 1000);

export interface ChargeBreakdown {
  totalKwh: number;
  /** Energy stored in the pack, and energy spent heating or cooling it. */
  packKwh: number;
  thermalKwh: number;
  chargingMinutes: number;
  rangeAddedKm: number | null;
  cost: { amount: number; currency: string } | null;
}

/**
 * `charge_session_breakdown` (`k70/b`): 1 total kWh, 2 pack kWh, 5 thermal
 * kWh, 6 minutes charging, 8 range added (km), 11 cost (money). Rivian keeps
 * the last session's breakdown and sends it on subscribe. Confirmed against
 * a home session: 35.8 = 34.4 + 1.4 kWh, 313 min, 162 km, matching Rivian's
 * history. Proto3 omits zeros, so missing numbers read as 0.
 */
export function decodeChargeBreakdown(payloadBase64: string): ChargeBreakdown | null {
  const m = decode(payloadBase64);
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
  const m = decode(payloadBase64);
  if (!m) return null;
  const charge = m.message(1);
  const temps = m.message(2);
  const avg = f32(temps?.float(1) ?? null);
  const max = f32(temps?.float(2) ?? null);
  const min = f32(temps?.float(3) ?? null);
  return {
    soc: f32(charge?.double(1) ?? null),
    capacityKwh: f32(charge?.double(2) ?? null),
    cellTemps: avg != null && max != null && min != null ? { avgC: avg, maxC: max, minC: min } : null,
  };
}

export interface ColdWeather {
  /** Battery % usable now, % held back by the cold, and range lost (km). */
  usableSoc: number | null;
  coldSoc: number;
  rangeImpactKm: number;
}

/** `cold_weather_soc` (`k70/k`): 1 usable SOC %, 2 cold-limited SOC %, 3 range impact km. */
export function decodeColdWeather(payloadBase64: string): ColdWeather | null {
  const m = decode(payloadBase64);
  if (!m) return null;
  const num = (n: number) => m.int(n) ?? f32(m.float(n));
  return { usableSoc: num(1), coldSoc: num(2) ?? 0, rangeImpactKm: num(3) ?? 0 };
}

export interface ParkedEnergyWindow {
  minutes: number;
  kwh: number;
  rangeKm: number;
}

/**
 * `parked_energy_distributions` (`k70/o`): repeated windows {1 total kWh,
 * 6 total range km, 11 window length in minutes}; 2–5 and 7–10 split them
 * into categories the docs don't name. 1440- and 480-minute windows drain
 * at the same rate, which supports reading 11 as minutes.
 */
export function decodeParkedEnergy(payloadBase64: string): ParkedEnergyWindow[] {
  const m = decode(payloadBase64);
  if (!m) return [];
  const windows: ParkedEnergyWindow[] = [];
  for (const field of [1, 2, 3, 4]) {
    const w = m.message(field);
    const minutes = w?.int(11);
    if (!w || !minutes || minutes <= 0) continue;
    windows.push({ minutes, kwh: f32(w.float(1)) ?? 0, rangeKm: f32(w.float(6)) ?? 0 });
  }
  return windows;
}

export interface NetworkState {
  wifi: { ssid: string; rssiDbm: number | null; frequencyMhz: number | null } | null;
  cellular: { carrier: string | null; technology: string | null } | null;
}

/**
 * `vehicle.network.state`: 4 Wi-Fi {3 SSID, 8 RSSI dBm, 10 frequency MHz},
 * 5 cellular {1 carrier, 2 technology}. A Wi-Fi block without an SSID
 * means not connected.
 */
export function decodeNetwork(payloadBase64: string): NetworkState | null {
  const m = decode(payloadBase64);
  if (!m) return null;
  const wifi = m.message(4);
  const cell = m.message(5);
  const ssid = wifi?.string(3);
  const rssi = wifi?.int(8) ?? null;
  const frequency = wifi?.int(10) ?? null;
  const carrier = cell?.string(1) || null;
  const technology = cell?.string(2) || null;
  return {
    wifi: ssid
      ? {
          ssid,
          rssiDbm: rssi != null && rssi < 0 && rssi > -130 ? rssi : null,
          frequencyMhz: frequency && frequency > 0 ? frequency : null,
        }
      : null,
    cellular: carrier || technology ? { carrier, technology } : null,
  };
}

export interface TripInfo {
  destination: { name: string | null; lat: number; lon: number };
  totalDistanceKm: number | null;
  totalDurationS: number | null;
  /** Battery % and range the navigation predicts on arrival. */
  arrivalSoc: number | null;
  arrivalRangeKm: number | null;
}

/**
 * `trip_info` (`t70/v`), the active navigation route; empty when not
 * navigating. 3 route {1 distance m, 2 duration s, 3 stops {1 stop {1
 * location {1 lat, 2 lon}, 4 address, 5 place id}}}, 6 arrival SOC %, 7
 * arrival range (m). Read from a live trip: 30.8 km / 37 min to an address,
 * arriving at 63% (from 69.8%) with 339 km of range.
 */
export function decodeTripInfo(payloadBase64: string): TripInfo | null {
  const m = decode(payloadBase64);
  const route = m?.message(3);
  const stop = route?.message(3)?.message(1);
  const location = stop?.message(1);
  const lat = location?.double(1);
  const lon = location?.double(2);
  if (!m || lat == null || lon == null) return null;
  const rangeM = m.double(7);
  return {
    destination: { name: stop?.string(4) || null, lat, lon },
    totalDistanceKm: route?.double(1) != null ? route.double(1)! / 1000 : null,
    totalDurationS: route?.double(2) ?? null,
    arrivalSoc: m.double(6),
    arrivalRangeKm: rangeM != null ? rangeM / 1000 : null,
  };
}

export interface TripProgress {
  /** Estimated arrival (ms since epoch). */
  etaMs: number | null;
  remainingKm: number | null;
  remainingS: number | null;
}

/**
 * `trip_progress` (`t70/x`), sent every few seconds while navigating: 1
 * {1 ETA, s since epoch}, 4 distance remaining (m), 5 time remaining (s).
 * Rivian keeps the last progress after a trip ends, so it only means
 * anything alongside a trip_info.
 */
export function decodeTripProgress(payloadBase64: string): TripProgress | null {
  const m = decode(payloadBase64);
  if (!m) return null;
  const eta = m.message(1)?.int(1);
  const remainingM = m.double(4);
  return {
    etaMs: eta && eta > 0 ? eta * 1000 : null,
    remainingKm: remainingM != null ? remainingM / 1000 : null,
    remainingS: m.double(5),
  };
}

export interface ChargingStatus {
  /** Raw enum values; their meanings aren't documented yet. */
  plugConnection: number;
  displayStatus: number;
  evseType: number;
}

/**
 * `charging.session.status` (`f70/v`): 1 plug connection status, 2 display
 * status, 3 EVSE type, all enums. Proto3 omits zeros, so missing reads as 0.
 * Unconfirmed against live payloads.
 */
export function decodeChargingStatus(payloadBase64: string): ChargingStatus | null {
  const m = decode(payloadBase64);
  if (!m) return null;
  return {
    plugConnection: m.int(1) ?? 0,
    displayStatus: m.int(2) ?? 0,
    evseType: m.int(3) ?? 0,
  };
}

/**
 * `charging.session.time_estimation` (`g70/e0`): 1 hold time (int32
 * seconds). Whether that's time to the limit or to a schedule's end is
 * unconfirmed.
 */
export function decodeTimeEstimation(payloadBase64: string): { holdTimeSeconds: number } | null {
  const m = decode(payloadBase64);
  if (!m) return null;
  return { holdTimeSeconds: Math.max(0, m.int(1) ?? 0) };
}
