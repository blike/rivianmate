import { describe, expect, it } from "vitest";
import { b64, float, graphBar, int, message } from "../testing/protobuf.js";
import { decodeChargingGraph, decodeChargingGraphBar, readProtoFields } from "./parallax.js";

const START = Date.parse("2026-10-01T07:00:00Z");
const bar = graphBar;

describe("readProtoFields", () => {
  it("reads varint, fixed32 and length-delimited fields", () => {
    const fields = readProtoFields(new Uint8Array([...int(1, 300), ...float(2, 1.5), ...message(3, [0x41])]));
    expect(fields?.map((f) => [f.field, f.wire])).toEqual([[1, 0], [2, 5], [3, 2]]);
  });

  it("rejects truncated or invalid bytes", () => {
    expect(readProtoFields(new Uint8Array([0x0a, 0x05, 0x01]))).toBeNull(); // length past the end
    expect(readProtoFields(new Uint8Array([0x0b]))).toBeNull(); // group wire type
  });
});

describe("decodeChargingGraphBar", () => {
  it("decodes SOC, power and the bar's time span", () => {
    const decoded = decodeChargingGraphBar(new Uint8Array(bar(42, 11.25, START, START + 60_000)));
    expect(decoded).toEqual({
      soc: 42,
      powerKw: 11.25,
      startMs: START,
      endMs: START + 60_000,
      chargingState: 3,
    });
  });

  it("treats a missing power as 0 kW (proto3 omits zeros) and needs a sane start", () => {
    expect(decodeChargingGraphBar(new Uint8Array([...int(1, 80), ...int(3, START)]))?.powerKw).toBe(0);
    expect(decodeChargingGraphBar(new Uint8Array([...int(1, 80), ...int(3, 12345)]))).toBeNull();
  });
});

describe("decodeChargingGraph", () => {
  it("collects every embedded bar in time order, whatever the repeated field number", () => {
    const payload = b64([
      ...message(1, bar(41, 11, START + 60_000, START + 120_000)),
      ...message(1, bar(40, 10.5, START, START + 60_000)),
      ...message(5, [...int(1, 7)]), // some other submessage: not a bar
    ]);
    expect(decodeChargingGraph(payload).map((b) => [b.soc, b.powerKw])).toEqual([[40, 10.5], [41, 11]]);
  });

  it("returns nothing for empty or malformed payloads", () => {
    expect(decodeChargingGraph("")).toEqual([]);
    expect(decodeChargingGraph(b64([0x0a, 0x09]))).toEqual([]);
  });
});
