import { describe, expect, it } from "vitest";
import type { StatDriveDto } from "@server/api-types.js";
import {
  bucketStart,
  chargeBuckets,
  driveAverageKmh,
  driveModeLabel,
  efficiencyDrives,
  granularityFor,
  groupEfficiency,
  percentile,
  rollingEfficiency,
  speedBandFor,
  speedBands,
} from "./stats.js";

const drive = (over: Partial<StatDriveDto>): StatDriveDto => ({
  id: 1,
  startedAt: "2026-09-01T12:00:00Z",
  durationS: 3600,
  distanceKm: 50,
  energyKwh: 10,
  driveMode: "everyday",
  ...over,
});

describe("efficiencyDrives", () => {
  it("keeps drives long enough to measure, with energy", () => {
    const kept = efficiencyDrives([
      drive({ id: 1 }),
      drive({ id: 2, distanceKm: 3 }),
      drive({ id: 3, energyKwh: null }),
      drive({ id: 4, energyKwh: 0 }),
    ]);
    expect(kept.map((d) => d.id)).toEqual([1]);
  });
});

describe("rollingEfficiency", () => {
  it("sums the trailing window, weighting by distance", () => {
    const r = rollingEfficiency(
      [
        { distanceKm: 10, energyKwh: 4 },
        { distanceKm: 90, energyKwh: 18 },
        { distanceKm: 20, energyKwh: 5 },
      ],
      2,
    );
    expect(r.map((x) => x.rolling)).toEqual([
      { distanceKm: 10, energyKwh: 4 },
      { distanceKm: 100, energyKwh: 22 },
      { distanceKm: 110, energyKwh: 23 },
    ]);
  });
});

describe("groupEfficiency", () => {
  it("sums distance and energy per key", () => {
    const groups = groupEfficiency(
      [
        { distanceKm: 10, energyKwh: 2, mode: "sport" },
        { distanceKm: 30, energyKwh: 5, mode: "sport" },
        { distanceKm: 30, energyKwh: 5, mode: null },
      ],
      (d) => d.mode,
    );
    expect([...groups]).toEqual([["sport", { drives: 2, distanceKm: 40, energyKwh: 7 }]]);
  });
});

describe("percentile", () => {
  it("interpolates between values", () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([5, 1, 3], 0.25)).toBe(2);
    expect(percentile([10, 20], 0.9)).toBe(19);
    expect(percentile([], 0.5)).toBeNull();
  });
});

describe("speed bands", () => {
  it("uses round numbers in the display unit", () => {
    expect(speedBands(true).map((b) => b.label)).toEqual([
      "Under 25 mph",
      "25–40 mph",
      "40–55 mph",
      "55–70 mph",
      "70+ mph",
    ]);
    expect(speedBands(false).at(-1)!.label).toBe("120+ km/h");
  });

  it("places a speed in its band", () => {
    const bands = speedBands(true);
    expect(speedBandFor(bands, 10).label).toBe("Under 25 mph");
    // 65 mph.
    expect(speedBandFor(bands, 104.6).label).toBe("55–70 mph");
    expect(speedBandFor(bands, 130).label).toBe("70+ mph");
  });

  it("averages speed over the whole drive", () => {
    expect(driveAverageKmh(drive({ distanceKm: 50, durationS: 1800 }))).toBe(100);
    expect(driveAverageKmh(drive({ durationS: 0 }))).toBeNull();
  });
});

describe("driveModeLabel", () => {
  it("uses the names the vehicle shows", () => {
    expect(driveModeLabel("everyday")).toBe("All-Purpose");
    expect(driveModeLabel("distance")).toBe("Conserve");
    expect(driveModeLabel("off_road_rocks")).toBe("Off-Road Rocks");
    expect(driveModeLabel("rally")).toBe("Rally");
    expect(driveModeLabel(null)).toBe("Unknown");
  });
});

describe("charge buckets", () => {
  it("picks coarser bars for longer spans", () => {
    expect(granularityFor(30)).toBe("day");
    expect(granularityFor(365)).toBe("week");
    expect(granularityFor(800)).toBe("month");
  });

  it("starts weeks on Monday and months on the 1st", () => {
    // Thursday, October 8, 2026.
    const thu = new Date(2026, 9, 8, 15);
    expect(bucketStart(thu, "week")).toEqual(new Date(2026, 9, 5));
    expect(bucketStart(thu, "month")).toEqual(new Date(2026, 9, 1));
    expect(bucketStart(new Date(2026, 9, 4), "week")).toEqual(new Date(2026, 8, 28));
  });

  it("sums days into buckets and keeps empty ones", () => {
    const r = chargeBuckets(
      [
        { day: "2026-10-01", acKwh: 10, dcKwh: 0, unknownKwh: 0 },
        { day: "2026-10-03", acKwh: 5, dcKwh: 40, unknownKwh: 1 },
      ],
      "day",
      new Date(2026, 9, 4, 12),
    );
    expect(r).toEqual([
      { start: new Date(2026, 9, 1).getTime(), acKwh: 10, dcKwh: 0, unknownKwh: 0 },
      { start: new Date(2026, 9, 2).getTime(), acKwh: 0, dcKwh: 0, unknownKwh: 0 },
      { start: new Date(2026, 9, 3).getTime(), acKwh: 5, dcKwh: 40, unknownKwh: 1 },
      { start: new Date(2026, 9, 4).getTime(), acKwh: 0, dcKwh: 0, unknownKwh: 0 },
    ]);
    const weeks = chargeBuckets([{ day: "2026-10-01", acKwh: 10, dcKwh: 0, unknownKwh: 0 }], "week", new Date(2026, 9, 6), new Date(2026, 8, 20));
    expect(weeks.map((w) => [new Date(w.start).getDate(), w.acKwh])).toEqual([
      [14, 0],
      [21, 0],
      [28, 10],
      [5, 0],
    ]);
  });

  it("is empty with no days and no start", () => {
    expect(chargeBuckets([], "day", new Date())).toEqual([]);
  });
});
