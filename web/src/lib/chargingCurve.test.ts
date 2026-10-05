import { describe, expect, it } from "vitest";
import { chargingCurveWindow } from "./chargingCurve.js";
const point = (hour: number, powerKw: number | null, projected = false) => ({
  ts: new Date(Date.UTC(2026, 9, 4, hour)).toISOString(), powerKw, soc: 50, projected,
});

describe("chargingCurveWindow", () => {
  it("excludes waiting before/after while retaining interior pauses and original timestamps", () => {
    const points = [point(18, null), point(19, 0), point(23, 7.2), point(24, 0), point(25, 7.4), point(26, 0), point(27, null)];
    const window = chargingCurveWindow(points);
    expect(window.points).toEqual(points.slice(2, 5));
    expect(window.originMs).toBe(Date.parse(points[2]!.ts));
    expect(new Date(window.originMs! + 120 * 60_000).toISOString()).toBe(points[4]!.ts);
    expect(points).toHaveLength(7);
  });

  it("keeps live forecast separate and does not let forecast power extend recorded boundaries", () => {
    const recorded = point(23, 7);
    const forecast = point(26, 100, true);
    expect(chargingCurveWindow([point(18, null), recorded, point(25, 0), forecast]).points).toEqual([recorded, forecast]);
  });

  it("does not infer charging boundaries from battery level alone", () => {
    const points = [point(18, null), point(19, null)];
    expect(chargingCurveWindow(points).points).toEqual(points);
    expect(chargingCurveWindow([])).toEqual({ points: [], originMs: null });
  });
});
