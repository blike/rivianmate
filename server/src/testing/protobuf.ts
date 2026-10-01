/** Minimal protobuf encoder for building Parallax test payloads. */
const varint = (n: bigint): number[] => {
  const out: number[] = [];
  do {
    let byte = Number(n & 0x7fn);
    n >>= 7n;
    if (n > 0n) byte |= 0x80;
    out.push(byte);
  } while (n > 0n);
  return out;
};
const key = (field: number, wire: number) => varint(BigInt((field << 3) | wire));

export const int = (field: number, n: number | bigint) => [...key(field, 0), ...varint(BigInt(n))];

export const float = (field: number, f: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setFloat32(0, f, true);
  return [...key(field, 5), ...b];
};

export const message = (field: number, body: number[]) => [
  ...key(field, 2),
  ...varint(BigInt(body.length)),
  ...body,
];

export const b64 = (bytes: number[]) => Buffer.from(bytes).toString("base64");

/** A `k70/g` charging graph bar. */
export const graphBar = (soc: number, kw: number, startMs: number, endMs: number) => [
  ...int(1, soc),
  ...float(2, kw),
  ...int(3, startMs),
  ...int(4, endMs),
  ...int(6, 3),
];

/** A `charging_graph_global` payload made of the given bars. */
export const chargingGraph = (...bars: number[][]) => b64(bars.flatMap((bar) => message(1, bar)));
