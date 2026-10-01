import { describe, expect, it } from "vitest";
import { chargingSecondsNow, socRange } from "./charging.js";
import { fmtSeconds } from "./state.js";

describe("chargingSecondsNow", () => {
  const now = Date.parse("2026-10-01T12:00:00Z");

  it("adds a running stretch to finished ones", () => {
    expect(chargingSecondsNow({ chargingSeconds: 600, chargingSince: "2026-10-01T11:30:00Z" }, now)).toBe(600 + 1800);
    expect(chargingSecondsNow({ chargingSeconds: 18779, chargingSince: null }, now)).toBe(18779);
  });

  it("is unknown for sessions RivianMate didn't watch", () => {
    expect(chargingSecondsNow({ chargingSeconds: null, chargingSince: null }, now)).toBeNull();
  });
});

describe("socRange", () => {
  it("shows start → end, marking a missing side", () => {
    expect(socRange(39.7, 70)).toBe("40→70%");
    expect(socRange(39.7, null)).toBe("40→?%");
    expect(socRange(null, null)).toBe("—");
  });
});

describe("fmtSeconds", () => {
  it("formats minutes and hours", () => {
    expect(fmtSeconds(45 * 60)).toBe("45m");
    expect(fmtSeconds(18779)).toBe("5h 13m");
  });
});
