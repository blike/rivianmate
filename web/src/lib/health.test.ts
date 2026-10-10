import type { VehicleState } from "@server/api-types.js";
import { describe, expect, it } from "vitest";
import { capacityOfRated, capacityTrend, healthChecks, healthSummary, tireTrend } from "./health.js";

const v = (value: string | number) => ({ timeStamp: "t", value });
const state = (fields: Record<string, string | number>) =>
  Object.fromEntries(Object.entries(fields).map(([k, x]) => [k, v(x)])) as unknown as VehicleState;

// As observed from a real vehicle.
const healthy = {
  batteryHvThermalEvent: "off",
  twelveVoltBatteryHealth: "NORMAL_OPERATION",
  tirePressureStatusFrontLeft: "OK",
  tirePressureStatusFrontRight: "OK",
  tirePressureStatusRearLeft: "OK",
  tirePressureStatusRearRight: "OK",
  wiperFluidState: "normal",
  otaCurrentVersion: "2026.36.0",
  otaAvailableVersion: "0.0.0",
};
const withBrakes = (s: VehicleState) => ({ ...s, brakeFluidLow: null }) as unknown as VehicleState;

describe("healthChecks", () => {
  it("reads a healthy vehicle as all good", () => {
    const checks = healthChecks(withBrakes(state(healthy)));
    expect(checks.map((c) => [c.label, c.level, c.value])).toEqual([
      ["Battery pack", "good", "Normal"],
      ["12V battery", "good", "Normal"],
      ["Tires", "good", "Normal"],
      ["Brake fluid", "good", "Normal"],
      ["Washer fluid", "good", "Normal"],
      ["Software", "good", "Up to date"],
    ]);
    expect(healthSummary(checks)).toMatchObject({ level: "good", title: "Everything looks good" });
  });

  it("flags what the vehicle warns about", () => {
    const s = state({ ...healthy, tirePressureStatusRearLeft: "LOW", wiperFluidState: "low", brakeFluidLow: "true" });
    const checks = healthChecks(s);
    const flagged = checks.filter((c) => c.level === "attention").map((c) => c.value);
    expect(flagged).toEqual(["Check rear left", "Low", "Low"]);
    expect(healthSummary(checks)).toMatchObject({ level: "attention", title: "3 things need a look" });
  });

  it("shows a pending update as information, a failed one as a problem", () => {
    const pending = healthChecks(state({ ...healthy, otaAvailableVersion: "2026.40.0" })).at(-1);
    expect(pending).toMatchObject({ level: "info", value: "Update available" });
    const failed = healthChecks(state({ ...healthy, otaCurrentStatus: "Install_Failed" })).at(-1);
    expect(failed).toMatchObject({ level: "attention", value: "Install failed" });
  });

  it("waits for readings before judging", () => {
    expect(healthSummary(healthChecks(undefined))).toMatchObject({ level: "unknown" });
    expect(healthSummary(healthChecks(state({ twelveVoltBatteryHealth: "NORMAL_OPERATION" })))).toMatchObject({
      level: "good",
      detail: "No warnings in what the vehicle has reported so far.",
    });
  });
});

describe("tireTrend", () => {
  const DAY = 86_400_000;
  const days = (n: number, f: (i: number) => Record<string, number>) =>
    Array.from({ length: n }, (_, i) => ({ ts: i * DAY, ...f(i) }));

  it("ignores pressure moving with the weather", () => {
    const t = tireTrend(days(10, (i) => ({ fl: 3.2 - i * 0.02, fr: 3.2 - i * 0.02, rl: 3.1 - i * 0.02, rr: 3.1 - i * 0.02 })));
    expect(t?.leaking).toBeNull();
    expect(t?.change.fl).toBeCloseTo(-0.16);
  });

  it("spots one tire falling against the others", () => {
    const t = tireTrend(days(10, (i) => ({ fl: 3.2, fr: 3.2 - i * 0.03, rl: 3.1, rr: 3.1 })));
    expect(t?.leaking).toBe("fr");
  });

  it("needs a few days of readings", () => {
    expect(tireTrend(days(3, () => ({ fl: 3 })))).toBeNull();
    expect(tireTrend(Array.from({ length: 10 }, (_, i) => ({ ts: i * 3600_000, fl: 3 })))).toBeNull();
  });
});

describe("capacityTrend", () => {
  it("compares the latest reading with the first", () => {
    expect(capacityTrend([])).toBeNull();
    expect(capacityTrend([{ at: "a", kwh: 111 }])).toEqual({ latestKwh: 111, changeKwh: null, since: null });
    const t = capacityTrend([{ at: "a", kwh: 111.5 }, { at: "b", kwh: 111.2 }]);
    expect(t?.changeKwh).toBeCloseTo(-0.3);
    expect(t?.since).toBe("a");
  });
});

describe("capacityOfRated", () => {
  it("compares reported capacity with rated", () => {
    expect(capacityOfRated(104.5, 110)).toBeCloseTo(95);
    // Packs often report a little over rated when new.
    expect(capacityOfRated(111.25, 110)).toBeCloseTo(101.14);
    expect(capacityOfRated(111, null)).toBeNull();
    expect(capacityOfRated(null, 110)).toBeNull();
  });
});
