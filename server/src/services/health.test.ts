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

  it("ignores driving, charging, being plugged in and long gaps", () => {
    const r = phantomDrain([
      snap(0, 80),
      snap(1, 75, 5000), // drove
      snap(2, 76, 5000, "chrgr_sts_connected_charging"), // charging
      snap(3, 90, 5000, "chrgr_sts_connected_no_chrg"), // plugged in
      snap(4, 90, 5000),
      snap(20, 85, 5000), // 16 h gap: blind spot
      snap(22, 84.8, 5000), // valid: 0.2 % in 2 h
    ]);
    expect(r.avgPctPerDay).toBeNull(); // only 2 h of parked data
    expect(r.days).toEqual([]);
  });

  it("ignores time in drive or reverse even if the odometer hasn't caught up", () => {
    const r = phantomDrain([
      snap(0, 80),
      { ...snap(0.5, 79), gear: "drive" },
      snap(1, 78),
      snap(5, 77.9),
      snap(9, 77.8),
    ]);
    expect(r.days[0]!.lossPct).toBeCloseTo(0.2);
    expect(r.days[0]!.parkedHours).toBeCloseTo(8);
  });

  it("nets out a reading that dips on wake and recovers", () => {
    // From a real vehicle: a 0.6 % blip once counted as ~30 %/day.
    const r = phantomDrain([
      snap(0, 56.9),
      snap(0.5, 56.3),
      snap(0.55, 56.7),
      snap(4, 56.7),
      snap(8, 56.7),
    ]);
    expect(r.days[0]!.lossPct).toBeCloseTo(0.2);
    expect(r.avgPctPerDay).toBeCloseTo(0.6);
  });

  it("leaves out days with too little parked time but keeps them in the average", () => {
    const r = phantomDrain([snap(18, 80), snap(24, 79), snap(26, 78.8)]);
    expect(r.days.map((d) => d.day)).toEqual(["2026-09-01"]);
    expect(r.avgPctPerDay).toBeCloseTo((1.2 / 8) * 24);
  });

  it("splits a stretch across days by time, in the given time zone", () => {
    const r = phantomDrain([snap(16, 80), snap(22, 79), snap(28, 78), snap(34, 77)]);
    expect(r.days.map((d) => d.day)).toEqual(["2026-09-01", "2026-09-02"]);
    // 16:00 UTC is 09:00 in Los Angeles, so all 18 h land on Sep 1.
    const la = phantomDrain(
      [snap(16, 80), snap(22, 79), snap(28, 78), snap(34, 77)],
      "America/Los_Angeles",
    );
    expect(la.days.map((d) => d.day)).toEqual(["2026-09-01"]);
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
