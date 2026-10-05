import { describe, expect, it } from "vitest";
import { reportedCapacity } from "./reported-capacity.js";

describe("reportedCapacity", () => {
  it("uses the latest report per day, not the highest value or input order", () => {
    const result = reportedCapacity([
      { at: "2026-10-04T22:00:00Z", kwh: 111.2 },
      { at: "2026-10-04T01:00:00Z", kwh: 113 },
      { at: "2026-10-05T02:00:00Z", kwh: 110.9 },
      { at: "2026-10-03T22:00:00Z", kwh: 112 },
    ]);
    expect(result.reported.map(r => [r.day, r.kwh])).toEqual([
      ["2026-10-03", 112], ["2026-10-04", 111.2], ["2026-10-05", 110.9],
    ]);
    expect(result.latest).toEqual({ at: "2026-10-05T02:00:00.000Z", kwh: 110.9 });
  });

  it("groups by the report's UTC date and collapses repeated cached readings", () => {
    const reading = { at: "2026-10-04T20:00:00-07:00", kwh: 111 };
    expect(reportedCapacity([reading, reading]).reported).toEqual([
      { day: "2026-10-05", at: "2026-10-05T03:00:00.000Z", kwh: 111 },
    ]);
  });

  it("leaves invalid or missing data unknown instead of manufacturing zero capacity", () => {
    const invalid = [0, -1, 501, Infinity, NaN].map(kwh => ({ at: "2026-10-05T00:00:00Z", kwh }));
    invalid.push({ at: "bad timestamp", kwh: 111 });
    expect(reportedCapacity(invalid)).toEqual({ latest: null, reported: [] });
    expect(reportedCapacity([])).toEqual({ latest: null, reported: [] });
  });
});
