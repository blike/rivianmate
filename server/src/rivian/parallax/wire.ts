/**
 * Parallax wire format. Each message carries a base64 protobuf for one topic
 * ("RVM"). There are no public .proto files, so decoding is defensive:
 * anything unexpected is skipped, never thrown.
 */

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

/** Field accessors over one decoded message; wrong wire types read as absent. */
export interface Fields {
  float(n: number): number | null;
  double(n: number): number | null;
  /** Signed varint (int32/int64 two's complement). */
  int(n: number): number | null;
  string(n: number): string | null;
  message(n: number): Fields | null;
  /** Each embedded message in repeated field `n`, in order; entries that aren't messages are skipped. */
  repeated(n: number): Fields[];
}

export function fieldsOf(bytes: Uint8Array | null | undefined): Fields | null {
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
    repeated(n: number) {
      return fields.flatMap((f) => {
        const inner = f.field === n && f.wire === 2 ? fieldsOf(f.value) : null;
        return inner ? [inner] : [];
      });
    },
  };
}

/** A payload's fields; null when it's empty or isn't protobuf. */
export const decodePayload = (payloadBase64: string) =>
  payloadBase64 ? fieldsOf(Buffer.from(payloadBase64, 'base64')) : null;

/** Rounds float32 noise (34.4 arrives as 34.400001…). */
export const f32 = (n: number | null) => (n == null ? null : Math.round(n * 1000) / 1000);

/** Rivian's message time; seconds or milliseconds since the epoch. */
export function messageTime(timestamp: number | null): Date | null {
  if (!timestamp) return null;
  return new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp);
}
