import { describe, expect, it } from "vitest";
import { chargeSpans, chargingWindow } from "./charge-spans.js";

const H = 3600_000;
const at = (h: number) => new Date(Date.UTC(2026, 9, 1) + h * H);
const change = (h: number, status: string) => ({ ts: at(h), status });

describe("chargeSpans", () => {
  it("splits a plug-in into waiting and charging", () => {
    const spans = chargeSpans(
      [
        change(-2, "chrgr_sts_not_connected"),
        change(1, "chrgr_sts_connected_no_chrg"),
        change(3, "chrgr_sts_connected_charging"),
        change(6, "chrgr_sts_connected_no_chrg"),
        change(8, "chrgr_sts_not_connected"),
      ],
      at(0),
      at(24),
    );
    expect(spans).toEqual([
      { kind: "plugged", from: at(1), to: at(3) },
      { kind: "charging", from: at(3), to: at(6) },
      { kind: "plugged", from: at(6), to: at(8) },
    ]);
  });

  it("clips to the window and runs the last state to its end", () => {
    const spans = chargeSpans([change(-5, "chrgr_sts_connected_charging"), change(20, "chrgr_sts_connected_no_chrg")], at(0), at(24));
    expect(spans).toEqual([
      { kind: "charging", from: at(0), to: at(20) },
      { kind: "plugged", from: at(20), to: at(24) },
    ]);
  });
});

describe("chargingWindow", () => {
  const spans = [
    { kind: "plugged" as const, from: at(1), to: at(3) },
    { kind: "charging" as const, from: at(3), to: at(5) },
    { kind: "plugged" as const, from: at(5), to: at(5.5) },
    { kind: "charging" as const, from: at(5.5), to: at(7) },
    { kind: "plugged" as const, from: at(7), to: at(9) },
    { kind: "charging" as const, from: at(30), to: at(32) },
  ];

  it("spans the charging within the plug-in, not the waiting around it", () => {
    expect(chargingWindow(spans, at(1), at(9))).toEqual({ from: at(3), to: at(7) });
  });

  it("runs an open plug-in to its latest charging", () => {
    expect(chargingWindow(spans, at(29), null)).toEqual({ from: at(30), to: at(32) });
  });

  it("is null when it never charged", () => {
    expect(chargingWindow(spans, at(10), at(20))).toBeNull();
  });
});
