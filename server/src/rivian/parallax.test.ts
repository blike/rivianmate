import { describe, expect, it } from "vitest";
import { b64, double, float, graphBar, int, message, string } from "../testing/protobuf.js";
import {
  decodeBatteryState,
  decodeChargeBreakdown,
  decodeChargingGraph,
  decodeChargingGraphBar,
  decodeChargingStatus,
  decodeColdWeather,
  decodeNetwork,
  decodeParkedEnergy,
  decodeTimeEstimation,
  decodeTripInfo,
  decodeTripProgress,
  readProtoFields,
} from "./parallax.js";

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

// Payloads below mirror a live R1S capture's field layout and values.
describe("decodeChargeBreakdown", () => {
  it("splits a session's energy and reads its charging time and range", () => {
    const payload = b64([
      ...float(1, 35.8), ...float(2, 34.4), ...float(5, 1.4),
      ...int(6, 313), ...int(8, 162), ...message(11, []), ...int(12, 1), ...int(13, 1),
    ]);
    expect(decodeChargeBreakdown(payload)).toEqual({
      totalKwh: 35.8, packKwh: 34.4, thermalKwh: 1.4, chargingMinutes: 313, rangeAddedKm: 162, cost: null,
    });
  });

  it("reads a session cost", () => {
    const payload = b64([...float(1, 53), ...message(11, [...string(1, "USD"), ...int(2, 37), ...int(3, 810_000_000)])]);
    expect(decodeChargeBreakdown(payload)?.cost).toEqual({ amount: 37.81, currency: "USD" });
  });

  it("returns null for an empty payload", () => {
    expect(decodeChargeBreakdown("")).toBeNull();
  });
});

describe("decodeBatteryState", () => {
  it("reads SOC and capacity, and cell temperatures when awake", () => {
    const asleep = b64([...message(1, [...double(1, 69.9), ...double(2, 111.285)]), ...message(3, [])]);
    expect(decodeBatteryState(asleep)).toEqual({ soc: 69.9, capacityKwh: 111.285, cellTemps: null });
    const awake = decodeBatteryState(
      b64([...message(1, [...double(1, 58.2)]), ...message(2, [...float(1, 42.8), ...float(2, 46.6), ...float(3, 37.2)])]),
    );
    expect(awake?.cellTemps).toEqual({ avgC: 42.8, maxC: 46.6, minC: 37.2 });
  });
});

describe("decodeColdWeather", () => {
  it("treats omitted fields as no cold impact", () => {
    expect(decodeColdWeather(b64(int(1, 70)))).toEqual({ usableSoc: 70, coldSoc: 0, rangeImpactKm: 0 });
  });
});

describe("decodeParkedEnergy", () => {
  it("reads each window's energy, range and length", () => {
    const window = (kwh: number, km: number, minutes: number) =>
      [...float(1, kwh), ...float(2, 0.3), ...float(4, 0.8), ...float(6, km), ...float(7, 1.449), ...float(9, 3.865), ...int(11, minutes)];
    const payload = b64([...message(1, window(1.1, 5.314, 1440)), ...message(2, window(0.4, 1.932, 480))]);
    expect(decodeParkedEnergy(payload)).toEqual([
      { minutes: 1440, kwh: 1.1, rangeKm: 5.314 },
      { minutes: 480, kwh: 0.4, rangeKm: 1.932 },
    ]);
  });
});

describe("decodeNetwork", () => {
  it("reads the Wi-Fi network and cellular carrier", () => {
    const payload = b64([
      ...int(1, 1),
      ...message(2, [...int(1, 1), ...int(2, 2)]),
      ...message(4, [...int(1, 2), ...int(2, 2), ...string(3, "fatcat"), ...int(7, 3), ...int(8, -66), ...int(9, 72), ...int(10, 5240)]),
      ...message(5, [...string(1, "AT&T"), ...string(2, "LTE"), ...int(3, 3), ...int(4, -255)]),
    ]);
    expect(decodeNetwork(payload)).toEqual({
      wifi: { ssid: "fatcat", rssiDbm: -66, frequencyMhz: 5240 },
      cellular: { carrier: "AT&T", technology: "LTE" },
    });
  });

  it("reports no Wi-Fi without an SSID", () => {
    expect(decodeNetwork(b64(message(4, [...int(1, 1)])))?.wifi).toBeNull();
  });
});

// Field layout from a live navigation trip (location and address changed).
describe("decodeTripInfo / decodeTripProgress", () => {
  const stop = message(1, [
    ...message(1, [...double(1, 40.4842), ...double(2, -88.9937)]),
    ...message(2, [...double(1, 40.4842), ...double(2, -88.9937)]),
    ...int(3, 2),
    ...string(4, "100 Main St"),
    ...string(5, "place-id"),
    ...double(7, 63.27),
  ]);
  const tripInfo = b64([
    ...string(1, "-6117841862812636333"),
    ...message(2, [...message(1, [...double(1, 40.5), ...double(2, -89)]), ...float(3, 5.9)]),
    ...message(3, [...double(1, 30837), ...double(2, 2242), ...message(3, stop), ...message(4, string(3, "Via I-5 S"))]),
    ...double(5, 69.8),
    ...double(6, 63.259),
    ...double(7, 339440.3),
  ]);

  it("reads the destination, route length and predicted arrival", () => {
    expect(decodeTripInfo(tripInfo)).toEqual({
      destination: { name: "100 Main St", lat: 40.4842, lon: -88.9937 },
      totalDistanceKm: 30.837,
      totalDurationS: 2242,
      arrivalSoc: 63.259,
      arrivalRangeKm: 339.4403,
    });
  });

  it("is null when not navigating", () => {
    expect(decodeTripInfo("")).toBeNull();
  });

  it("reads ETA and what's left", () => {
    const progress = b64([
      ...message(1, int(1, 1790869380)),
      ...message(2, int(1, 1790869380)),
      ...double(4, 30506),
      ...double(5, 2220),
      ...message(6, [...message(1, [...double(1, 40.5), ...double(2, -89)]), ...float(2, 7.9)]),
    ]);
    expect(decodeTripProgress(progress)).toEqual({ etaMs: 1790869380000, remainingKm: 30.506, remainingS: 2220 });
  });
});

describe("decodeChargingStatus", () => {
  it("reads the enums, with omitted ones as 0", () => {
    expect(decodeChargingStatus(b64([...int(1, 2), ...int(3, 1)]))).toEqual({
      plugConnection: 2,
      displayStatus: 0,
      evseType: 1,
    });
    expect(decodeChargingStatus("")).toBeNull();
  });
});

describe("decodeTimeEstimation", () => {
  it("reads the hold time in seconds", () => {
    expect(decodeTimeEstimation(b64(int(1, 5400)))).toEqual({ holdTimeSeconds: 5400 });
  });
});
