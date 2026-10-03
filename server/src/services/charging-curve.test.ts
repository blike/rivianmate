import { describe, expect, it } from "vitest";
import { type CurvePoint, type CurveSource, curveForDisplay, forecastForDisplay } from "./charging-curve.js";

const p = (source: CurveSource, ts: string, powerKw: number | null, soc: number | null): CurvePoint => ({
  source,
  ts: new Date(ts),
  powerKw,
  soc,
});

describe("curveForDisplay", () => {
  it("drops points whose SoC fell further than charging allows (a real DC session)", () => {
    // Recorded before sources were kept apart: stray 0 kW points at an
    // older SoC interleaved with the real readings.
    const rows = [
      p("legacy", "2026-10-02T23:10:56.908Z", 0, 58),
      p("legacy", "2026-10-02T23:10:57.708Z", 124.7, 63),
      p("legacy", "2026-10-02T23:11:01.172Z", 0, 57),
      p("legacy", "2026-10-02T23:11:01.572Z", 124.7, 64),
      p("legacy", "2026-10-02T23:11:05.840Z", 124.7, 64),
      p("legacy", "2026-10-02T23:11:07.572Z", 0, 55),
      p("legacy", "2026-10-02T23:11:16.248Z", 0, 54),
      p("legacy", "2026-10-02T23:11:22.508Z", 0, 55),
      p("legacy", "2026-10-02T23:12:25.038Z", 109.8, 66),
      p("legacy", "2026-10-02T23:12:27.208Z", 109.8, 66),
    ];
    const curve = curveForDisplay(rows);
    expect(curve.map((r) => r.powerKw)).toEqual([0, 124.7, 124.7, 124.7, 109.8, 109.8]);
    expect(curve.map((r) => r.soc)).toEqual([58, 63, 64, 64, 66, 66]);
  });

  it("draws one source, never an interleaving, preferring the vehicle's graph", () => {
    const rows = [
      p("push_live", "2026-10-02T23:00:01Z", 120, null),
      p("graph", "2026-10-02T23:00:00Z", 118, 50),
      p("push_chart", "2026-10-02T23:00:30Z", 119, 51),
      p("graph", "2026-10-02T23:01:00Z", 117, 52),
      p("push_live", "2026-10-02T23:01:01Z", 121, null),
    ];
    const curve = curveForDisplay(rows);
    expect(curve.every((r) => r.source === "graph")).toBe(true);
    expect(curve).toHaveLength(2);
  });

  it("falls back when a source has no power readings", () => {
    const rows = [
      p("graph", "2026-10-02T23:00:00Z", null, 50),
      p("graph", "2026-10-02T23:01:00Z", null, 51),
      p("push_live", "2026-10-02T23:00:10Z", 120, null),
      p("push_live", "2026-10-02T23:00:40Z", 118, null),
    ];
    expect(curveForDisplay(rows).map((r) => r.source)).toEqual(["push_live", "push_live"]);
  });

  it("keeps SoC-only series when nothing has power, and allows a slow drop over time", () => {
    const rows = [
      p("graph", "2026-10-02T20:00:00Z", null, 80),
      // Hours later, plugged in but idle, the pack has drifted down: real.
      p("graph", "2026-10-02T23:00:00Z", null, 76),
    ];
    expect(curveForDisplay(rows).map((r) => r.soc)).toEqual([80, 76]);
  });

  it("is empty without points", () => {
    expect(curveForDisplay([])).toEqual([]);
  });
});

describe("curveForDisplay: forecasts stored as readings", () => {
  it("drops a tail where SoC keeps rising without power (an L2 session's stored forecast)", () => {
    const rows = [
      p("graph", "2026-10-03T19:58:00Z", 107, 54),
      p("graph", "2026-10-03T20:00:00Z", 111, 57),
      p("graph", "2026-10-03T20:04:00Z", 99, 60),
      // Stored before forecasts were kept apart: no power, SoC still climbing.
      p("graph", "2026-10-03T20:08:00Z", null, 63),
      p("graph", "2026-10-03T20:12:00Z", null, 66),
      p("graph", "2026-10-03T20:15:00Z", null, 70),
    ];
    expect(curveForDisplay(rows).map((r) => r.soc)).toEqual([54, 57, 60]);
  });

  it("keeps an idle tail after the charge finished (no power, SoC flat)", () => {
    const rows = [
      p("graph", "2026-10-03T19:00:00Z", 11, 80),
      p("graph", "2026-10-03T20:00:00Z", 11, 90),
      p("graph", "2026-10-03T21:00:00Z", 0, 90),
      p("graph", "2026-10-03T23:00:00Z", null, 89),
    ];
    expect(curveForDisplay(rows)).toHaveLength(4);
  });
});

describe("forecastForDisplay", () => {
  const recorded = [p("graph", "2026-10-03T20:00:00Z", 110, 57), p("graph", "2026-10-03T20:05:00Z", 100, 61)];
  const rows = [
    ...recorded,
    p("forecast", "2026-10-03T20:04:00Z", null, 60), // overlaps what's recorded
    p("forecast", "2026-10-03T20:20:00Z", null, 70),
    p("forecast", "2026-10-03T20:10:00Z", null, 65),
  ];

  it("returns the forecast after the last recorded point, in time order", () => {
    expect(forecastForDisplay(rows, recorded, true).map((r) => r.soc)).toEqual([65, 70]);
  });

  it("is empty once the charge has ended", () => {
    expect(forecastForDisplay(rows, recorded, false)).toEqual([]);
  });

  it("is never chosen as the recorded curve", () => {
    expect(curveForDisplay(rows).every((r) => r.source === "graph")).toBe(true);
  });
});
