import { describe, expect, it } from "vitest";
import { parkedSegments, parkedWindows, signalLabel, wifiBand, windowLabel } from "./insights.js";

describe("parkedWindows", () => {
  it("keeps whole-hour windows, longest first", () => {
    const windows = [{ minutes: 480 }, { minutes: 8 }, { minutes: 1440 }];
    expect(parkedWindows(windows).map((w) => windowLabel(w.minutes))).toEqual(["Last 24 hours", "Last 8 hours"]);
  });
});

describe("wifiBand / signalLabel", () => {
  it("names the band and signal strength", () => {
    expect([wifiBand(2437), wifiBand(5240), wifiBand(5955), wifiBand(null)]).toEqual(["2.4 GHz", "5 GHz", "6 GHz", null]);
    expect([signalLabel(-55), signalLabel(-66), signalLabel(-75), signalLabel(-90)]).toEqual(["Strong", "Good", "Fair", "Weak"]);
  });
});

describe("parkedSegments", () => {
  it("keeps the uses that drew energy, in legend order", () => {
    expect(parkedSegments({ climate: 0.4, system: 1.7, gearGuardAndOutlets: 0 }).map((s) => [s.label, s.kwh])).toEqual([
      ["System", 1.7],
      ["Climate", 0.4],
    ]);
    expect(parkedSegments({ climate: 0, system: 0, gearGuardAndOutlets: 0 })).toEqual([]);
  });
});
