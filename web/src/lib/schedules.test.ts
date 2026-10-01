import { describe, expect, it } from "vitest";
import { formatDuration, formatTimeOfDay, formatWeekDays } from "./schedules.js";

describe("schedule formatting", () => {
  it("formats minutes after midnight as a clock time", () => {
    expect(formatTimeOfDay(23 * 60)).toMatch(/11:00\s?PM|23:00/);
    expect(formatTimeOfDay(null)).toBe("—");
  });

  it("formats durations", () => {
    expect(formatDuration(420)).toBe("7 h");
    expect(formatDuration(90)).toBe("1 h 30 min");
    expect(formatDuration(45)).toBe("45 min");
  });

  it("summarizes weekday lists", () => {
    expect(formatWeekDays(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"])).toBe("Weekdays");
    expect(formatWeekDays(["SATURDAY", "sunday"])).toBe("Weekends");
    expect(formatWeekDays(["Friday", "Monday", "Wednesday"])).toBe("Mon, Wed, Fri");
    expect(formatWeekDays(["monday","tuesday","wednesday","thursday","friday","saturday","sunday"])).toBe("Every day");
    expect(formatWeekDays(["MON_ODD"])).toBe("MON_ODD");
  });
});
