import { describe, expect, it } from "vitest";
import { smoothByTime, smoothingWindowMinutes } from "./smoothing.js";

describe("smoothByTime", () => {
  it("averages each value with its neighbours inside the window", () => {
    const xs = [0, 1, 2, 3, 4];
    expect(smoothByTime(xs, [100, 120, 100, 120, 100], 2)).toEqual([110, 320 / 3, 340 / 3, 320 / 3, 110]);
  });

  it("leaves gaps as gaps and skips them in the average", () => {
    const xs = [0, 1, 2, 3];
    expect(smoothByTime(xs, [10, null, 20, 30], 2)).toEqual([10, null, 25, 25]);
  });

  it("uses time, not position: far-apart points don't blend", () => {
    expect(smoothByTime([0, 1, 60], [10, 20, 90], 4)).toEqual([15, 15, 90]);
  });

  it("returns short or unsmoothable series unchanged", () => {
    expect(smoothByTime([0, 1], [1, 2], 5)).toEqual([1, 2]);
    expect(smoothByTime([0, 1, 2], [1, 2, 3], 0)).toEqual([1, 2, 3]);
  });
});

describe("smoothingWindowMinutes", () => {
  it("scales with the chart's span, never under a minute", () => {
    expect(smoothingWindowMinutes(10)).toBe(1);
    expect(smoothingWindowMinutes(480)).toBe(24);
  });
});
