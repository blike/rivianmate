import { describe, expect, it } from "vitest";
import { haversineKm, withCumulativeKm } from "./geo.js";

describe("geo", () => {
  it("measures one degree of latitude as ~111 km", () => {
    expect(haversineKm(40, -88, 41, -88)).toBeCloseTo(111.2, 0);
  });

  it("accumulates distance along a route", () => {
    const pts = withCumulativeKm([
      { lat: 40, lon: -88 },
      { lat: 40.5, lon: -88 },
      { lat: 41, lon: -88 },
    ]);
    expect(pts[0]!.km).toBe(0);
    expect(pts[2]!.km).toBeCloseTo(111.2, 0);
  });
});
