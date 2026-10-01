import { describe, expect, it } from "vitest";
import { capacityEstimates, phantomDrain } from "./health.js";

const at = (h: number) => new Date(Date.UTC(2026, 8, 1, 0) + h * 3600_000);
const snap = (h: number, battery: number, mileage = 1000, charger = "chrgr_sts_not_connected") => ({
  ts: at(h),
  batteryLevel: battery,
  mileageM: mileage,
  chargerStatus: charger,
});

describe("phantomDrain", () => {
  it("measures loss while parked and normalizes to per day", () => {
    const r = phantomDrain([snap(0, 80), snap(4, 79.5), snap(8, 79), snap(12, 78.5)]);
    expect(r.days).toHaveLength(1);
    expect(r.days[0]!.lossPct).toBeCloseTo(1.5);
    expect(r.days[0]!.parkedHours).toBeCloseTo(12);
    expect(r.avgPctPerDay).toBeCloseTo(3);
  });

  it("ignores driving, charging, battery gains and long gaps", () => {
    const r = phantomDrain([
      snap(0, 80),
      snap(1, 75, 5000), // drove
      snap(2, 76, 5000, "chrgr_sts_connected_charging"), // charging
      snap(3, 90, 5000), // battery rose
      snap(20, 85, 5000), // 17 h gap: blind spot
      snap(22, 84.8, 5000), // valid: 0.2 % in 2 h
    ]);
    expect(r.days.reduce((a, d) => a + d.lossPct, 0)).toBeCloseTo(0.2);
    expect(r.avgPctPerDay).toBeNull(); // only 2 h of parked data
  });

  it("splits by UTC day", () => {
    const r = phantomDrain([snap(20, 80), snap(24, 79), snap(28, 78)]);
    expect(r.days.map((d) => d.day)).toEqual(["2026-09-01", "2026-09-02"]);
  });
});

describe("capacityEstimates", () => {
  it("estimates capacity from energy and SoC gained, skipping small sessions", () => {
    const r = capacityEstimates([
      { id: 1, startedAt: at(0), startSoc: 20, endSoc: 80, energyKwh: 78 },
      { id: 2, startedAt: at(24), startSoc: 70, endSoc: 80, energyKwh: 13 },
      { id: 3, startedAt: at(48), startSoc: 30, endSoc: 70, energyKwh: null },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]!.estimatedKwh).toBeCloseTo(130);
    expect(r[0]!.socGain).toBe(60);
  });
});
