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
  "energy.high_voltage.battery_state",
  "charging.session.status",
  "charging.session.time_estimation",
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
