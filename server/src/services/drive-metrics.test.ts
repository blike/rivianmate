import { describe, expect, it } from "vitest";
import { driveEnergyKwh, elevationChange } from "./drive-metrics.js";

describe("elevationChange", () => {
  it("ignores GPS jitter below the threshold", () => {
    expect(elevationChange([100, 101, 99, 102, 100, 101])).toEqual({ gainM: 0, lossM: 0 });
  });

  it("counts a real climb and descent once", () => {
    // Climb 100 -> 150 with jitter, then descend to 120.
    const alts = [100, 101, 110, 108, 125, 150, 149, 140, 120];
    const r = elevationChange(alts)!;
    expect(r.gainM).toBe(50);
    expect(r.lossM).toBe(30);
  });

  it("needs at least two readings", () => {
    expect(elevationChange([100])).toBeNull();
    expect(elevationChange([])).toBeNull();
  });
});

describe("driveEnergyKwh", () => {
  it("multiplies the battery drop by capacity", () => {
    expect(driveEnergyKwh(80, 70, 130)).toBeCloseTo(13);
  });

  it("returns null when the battery did not drop or inputs are missing", () => {
    expect(driveEnergyKwh(70, 72, 130)).toBeNull();
    expect(driveEnergyKwh(80, 70, null)).toBeNull();
    expect(driveEnergyKwh(null, 70, 130)).toBeNull();
  });
});
