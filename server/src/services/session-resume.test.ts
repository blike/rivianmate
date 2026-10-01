import { describe, expect, it } from "vitest";
import { closeTime } from "./session-resume.js";

const open = (startedAt: string, lastSampleAt: string | null, chargingSince: string | null = null) => ({
  id: 1,
  startedAt: new Date(startedAt),
  lastSampleAt: lastSampleAt ? new Date(lastSampleAt) : null,
  chargingSeconds: 0,
  chargingSince: chargingSince ? new Date(chargingSince) : null,
});

describe("closeTime", () => {
  it("uses the latest recorded activity", () => {
    expect(closeTime(open("2026-10-01T10:00:00Z", "2026-10-01T10:40:00Z")).toISOString()).toBe("2026-10-01T10:40:00.000Z");
    expect(closeTime(open("2026-10-01T10:00:00Z", null, "2026-10-01T11:00:00Z")).toISOString()).toBe("2026-10-01T11:00:00.000Z");
    expect(closeTime(open("2026-10-01T10:00:00Z", null)).toISOString()).toBe("2026-10-01T10:00:00.000Z");
  });
});
