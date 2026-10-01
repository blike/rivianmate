import { describe, expect, it } from "vitest";
import type { LiveSessionData } from "../rivian/types.js";
import { closeTime, isSameSession } from "./session-resume.js";

const NOW = Date.parse("2026-10-01T12:00:00Z");
const live = (startTime: string | null) => ({ startTime }) as LiveSessionData;
const open = (startedAt: string, lastSampleAt: string | null) => ({
  id: 1,
  startedAt: new Date(startedAt),
  lastSampleAt: lastSampleAt ? new Date(lastSampleAt) : null,
});

describe("isSameSession", () => {
  it("matches on Rivian's start time within tolerance", () => {
    const o = open("2026-10-01T10:00:00Z", "2026-10-01T10:30:00Z");
    expect(isSameSession(o, live("2026-10-01T10:03:00Z"), NOW)).toBe(true);
    expect(isSameSession(o, live("2026-10-01T11:30:00Z"), NOW)).toBe(false);
  });

  it("falls back to a recent sample when there is no start time", () => {
    expect(isSameSession(open("2026-10-01T10:00:00Z", "2026-10-01T11:45:00Z"), live(null), NOW)).toBe(true);
    expect(isSameSession(open("2026-10-01T10:00:00Z", "2026-10-01T10:30:00Z"), live(null), NOW)).toBe(false);
    expect(isSameSession(open("2026-10-01T10:00:00Z", null), live(null), NOW)).toBe(false);
  });
});

describe("closeTime", () => {
  it("prefers the last sample over the start", () => {
    expect(closeTime(open("2026-10-01T10:00:00Z", "2026-10-01T10:40:00Z")).toISOString()).toBe("2026-10-01T10:40:00.000Z");
    expect(closeTime(open("2026-10-01T10:00:00Z", null)).toISOString()).toBe("2026-10-01T10:00:00.000Z");
  });
});
