import { describe, expect, it } from "vitest";
import { averageSpeedKmh, driveProfile, rangeUsedKm } from "./drives.js";

describe("driveProfile", () => {
  it("places points by minutes into the drive", () => {
    const point = (ts: string, speedKmh: number | null, altitude: number | null) =>
      ({ ts, lat: 0, lon: 0, bearing: null, speedKmh, altitude });
    expect(
      driveProfile(
        [point("2026-10-01T15:00:00Z", 0, 10), point("2026-10-01T15:01:30Z", 48, 12), point("2026-10-01T15:02:00Z", null, null)],
        "2026-10-01T15:00:00Z",
      ),
    ).toEqual([
      { minutes: 0, speedKmh: 0, altitudeM: 10 },
      { minutes: 1.5, speedKmh: 48, altitudeM: 12 },
    ]);
  });
});

describe("averageSpeedKmh / rangeUsedKm", () => {
  it("averages over the drive, running to now while in progress", () => {
    expect(averageSpeedKmh(30, "2026-10-01T15:00:00Z", "2026-10-01T15:30:00Z")).toBe(60);
    expect(averageSpeedKmh(10, "2026-10-01T15:00:00Z", null, Date.parse("2026-10-01T15:15:00Z"))).toBe(40);
    expect(averageSpeedKmh(null, "2026-10-01T15:00:00Z", null)).toBeNull();
  });

  it("reports range used only when it dropped", () => {
    expect(rangeUsedKm(375, 357)).toBe(18);
    expect(rangeUsedKm(357, 375)).toBeNull();
  });
});
