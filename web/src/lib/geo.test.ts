import { describe, expect, it } from "vitest";
import { haversineKm, isPosition, withCumulativeKm } from "./geo.js";

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

describe("isPosition", () => {
  it("drops the 0,0 Rivian sends without a fix, and impossible positions", () => {
    expect(isPosition(0, 0)).toBe(false);
    expect(isPosition(95, -116)).toBe(false);
    expect(isPosition(Number.NaN, -116)).toBe(false);
  });

  it("keeps real positions", () => {
    expect(isPosition(34.0026, -116.0522)).toBe(true);
    expect(isPosition(51.48, 0)).toBe(true);
  });
});
