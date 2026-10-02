import { describe, expect, it } from "vitest";
import {
  dayLabel,
  formatDuration,
  formatSeatLevel,
  formatTimeOfDay,
  formatTimeRange,
  formatWeekDays,
  scheduleStatus,
  weekSpans,
} from "./schedules.js";

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

describe("formatSeatLevel", () => {
  it("spaces Rivian's level names", () => {
    expect(formatSeatLevel("Heat2")).toBe("Heat 2");
    expect(formatSeatLevel("Off")).toBe("Off");
    expect(formatSeatLevel(null)).toBe("—");
  });
});

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const WEEKENDS = ["Saturday", "Sunday"];
const mine = [
  { startTime: 0, duration: 360, weekDays: WEEKDAYS },
  { startTime: 0, duration: 840, weekDays: WEEKENDS },
];

describe("weekSpans", () => {
  it("lays each day's windows out, Monday first", () => {
    const week = weekSpans(mine);
    expect(week[0]).toEqual([[0, 360]]);
    expect(week[5]).toEqual([[0, 840]]);
  });

  it("carries a window past midnight into the next day, wrapping Sunday to Monday", () => {
    const week = weekSpans([{ startTime: 23 * 60, duration: 420, weekDays: ["Sunday"] }]);
    expect(week[6]).toEqual([[1380, 1440]]);
    expect(week[0]).toEqual([[0, 360]]);
  });
});

describe("scheduleStatus", () => {
  // Friday 2 October 2026, local time.
  const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m);

  it("reports an open window and when it ends", () => {
    expect(scheduleStatus(mine, at(2, 3))).toEqual({ open: true, endsAt: at(2, 6) });
  });

  it("finds the next window, including the weekend's", () => {
    expect(scheduleStatus(mine, at(2, 9))).toEqual({ open: false, startsAt: at(3, 0) });
    expect(scheduleStatus(mine, at(4, 15))).toEqual({ open: false, startsAt: at(5, 0) });
  });

  it("follows a window running past midnight", () => {
    const late = [{ startTime: 23 * 60, duration: 420, weekDays: ["Friday"] }];
    expect(scheduleStatus(late, at(3, 2))).toEqual({ open: true, endsAt: at(3, 6) });
  });

  it("is null with no usable schedule", () => {
    expect(scheduleStatus([{ startTime: null, duration: 60, weekDays: WEEKDAYS }], at(2, 9))).toBeNull();
  });
});

describe("time ranges and day labels", () => {
  it("formats a window as start – end", () => {
    expect(formatTimeRange(0, 360)).toMatch(/^12:00\s?AM – 6:00\s?AM$|^0:00 – 6:00$|^00:00 – 06:00$/);
  });

  it("names the day relative to now", () => {
    const now = new Date(2026, 9, 2, 9);
    expect(dayLabel(new Date(2026, 9, 2, 22), now)).toBe("today");
    expect(dayLabel(new Date(2026, 9, 3, 0), now)).toBe("tonight");
    expect(dayLabel(new Date(2026, 9, 3, 9), now)).toBe("tomorrow");
    expect(dayLabel(new Date(2026, 9, 5, 0), now)).toBe("Monday");
  });
});
