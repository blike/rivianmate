import { describe, expect, it } from "vitest";
import { timeTicks } from "./timeAxis.js";

const local = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();

describe("timeTicks", () => {
  it("uses hour ticks with times of day for a span under a day, dates at midnight", () => {
    const { ticks, format } = timeTicks(local(1, 4, 40), local(2, 2, 36));
    expect(ticks.length).toBeLessThanOrEqual(8);
    expect(ticks.every((t) => new Date(t).getMinutes() === 0 && new Date(t).getHours() % 3 === 0)).toBe(true);
    expect(ticks[0]).toBe(local(1, 6));
    const labels = ticks.map(format);
    expect(new Set(labels).size).toBe(labels.length);
    expect(format(local(2, 0))).toBe(new Date(local(2, 0)).toLocaleDateString([], { month: "short", day: "numeric" }));
  });

  it("uses one tick per local midnight for a week", () => {
    const { ticks, format } = timeTicks(local(1, 9), local(8, 9));
    expect(ticks).toEqual([2, 3, 4, 5, 6, 7, 8].map((d) => local(d, 0)));
    expect(new Set(ticks.map(format)).size).toBe(7);
  });

  it("spaces ticks out for long ranges", () => {
    const { ticks } = timeTicks(local(1, 0), local(1, 0) + 90 * 86_400_000);
    expect(ticks.length).toBeLessThanOrEqual(8);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
  });
});
