import { describe, expect, it } from "vitest";
import { isPosition, stateLocation } from "./state-utils.js";

describe("stateLocation", () => {
  const at = (latitude: number, longitude: number) =>
    stateLocation({ gnssLocation: { latitude, longitude, timeStamp: "2026-10-04T16:00:00Z" } });

  it("returns a real fix", () => {
    expect(at(34.0026, -116.0522)?.latitude).toBe(34.0026);
  });

  it("drops the 0,0 Rivian sends without a fix, and impossible positions", () => {
    expect(at(0, 0)).toBeNull();
    expect(at(0.00001, -0.00002)).toBeNull();
    expect(at(91, 10)).toBeNull();
    expect(at(10, -181)).toBeNull();
    expect(at(Number.NaN, 10)).toBeNull();
  });

  it("keeps real places near the equator or the prime meridian", () => {
    expect(isPosition(0, 32.5)).toBe(true); // Lake Victoria
    expect(isPosition(51.48, 0)).toBe(true); // Greenwich
  });
});
