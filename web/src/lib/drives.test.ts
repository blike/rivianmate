import { describe, expect, it } from "vitest";
import { averageSpeedKmh, driveProfile, drivesByDay, minuteTicks, profilePosition, rangeUsedKm } from "./drives.js";

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
      { minutes: 0, speedKmh: 0, altitudeM: 10, lat: null, lon: null },
      { minutes: 1.5, speedKmh: 48, altitudeM: 12, lat: null, lon: null },
    ]);
  });

  it("keeps each reading's position", () => {
    expect(
      driveProfile([{ ts: "2026-10-01T15:00:00Z", lat: 40.1, lon: -88.2, bearing: null, speedKmh: 30, altitude: null }], "2026-10-01T15:00:00Z"),
    ).toEqual([{ minutes: 0, speedKmh: 30, altitudeM: null, lat: 40.1, lon: -88.2 }]);
  });
});

describe("profilePosition", () => {
  const at = (lat: number | null) => ({ lat, lon: lat == null ? null : -88 });

  it("uses the point's own fix, else the nearest one", () => {
    const profile = [at(40), at(null), at(null), at(41)];
    expect(profilePosition(profile, 0)).toEqual([40, -88]);
    expect(profilePosition(profile, 1)).toEqual([40, -88]);
    expect(profilePosition(profile, 2)).toEqual([41, -88]);
    expect(profilePosition([at(null)], 0)).toBeNull();
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

describe("drivesByDay", () => {
  const now = new Date(2026, 9, 10, 18, 0);
  const at = (day: number, hour: number) => new Date(2026, 9, day, hour).toISOString();

  it("groups newest-first drives by local day with totals", () => {
    const days = drivesByDay(
      [
        { startedAt: at(10, 9), distanceKm: 10 },
        { startedAt: at(10, 7), distanceKm: 5 },
        { startedAt: at(9, 17), distanceKm: null },
        { startedAt: at(7, 8), distanceKm: 20 },
      ],
      now,
    );
    expect(days.map((d) => [d.label, d.drives.length, d.distanceKm])).toEqual([
      ["Today", 2, 15],
      ["Yesterday", 1, 0],
      [new Date(2026, 9, 7).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }), 1, 20],
    ]);
  });
});

describe("minuteTicks", () => {
  it("lands on whole minutes", () => {
    expect(minuteTicks(0.2, 10)).toEqual([2, 4, 6, 8, 10]);
    expect(minuteTicks(0, 95)).toEqual([0, 30, 60, 90]);
    expect(minuteTicks(0, 3.5)).toEqual([0, 1, 2, 3]);
    // Under a minute, no whole minute falls inside.
    expect(minuteTicks(0.4, 0.6)).toEqual([]);
  });
});
