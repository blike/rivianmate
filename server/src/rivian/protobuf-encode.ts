/** Minimal protobuf encoder, for mock-mode and test Parallax payloads. */
const varint = (n: bigint): number[] => {
  const out: number[] = [];
  n = BigInt.asUintN(64, n); // negatives as two's complement, like int64
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

export const double = (field: number, f: number) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, f, true);
  return [...key(field, 1), ...b];
};

export const message = (field: number, body: number[]) => [
  ...key(field, 2),
  ...varint(BigInt(body.length)),
  ...body,
];

export const string = (field: number, text: string) => message(field, [...new TextEncoder().encode(text)]);

export const b64 = (bytes: number[]) => Buffer.from(bytes).toString("base64");
