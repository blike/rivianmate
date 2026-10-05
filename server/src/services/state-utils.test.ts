import { describe, expect, it } from "vitest";
import type { VehicleState } from "../rivian/types.js";
import { PARALLAX_DYNAMICS_FIELDS } from "../rivian/parallax.js";
import { isPosition, mergeVehicleState, stateLocation } from "./state-utils.js";

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

describe("GPS and tire stream fallback", () => {
  it("accepts legacy-only fields and keeps the newest readings as sources change", () => {
    const cached: VehicleState = {};
    const oldAt = "2026-10-04T10:00:00Z";
    const at = "2026-10-04T10:01:00Z";
    const nextAt = "2026-10-04T10:02:00Z";
    // Legacy remains usable when dynamics has never delivered (including rejection).
    mergeVehicleState(cached, { gnssSpeed: { timeStamp: oldAt, value: 5 } }, PARALLAX_DYNAMICS_FIELDS);
    expect(cached.gnssSpeed?.value).toBe(5);
    // A newer Parallax reading takes over.
    mergeVehicleState(cached, { gnssSpeed: { timeStamp: at, value: 10 } }, PARALLAX_DYNAMICS_FIELDS);
    // A delayed legacy speed must not roll it back; an unreported tire still updates.
    mergeVehicleState(cached, {
      gnssSpeed: { timeStamp: oldAt, value: 0 },
      tirePressureFrontLeft: { timeStamp: oldAt, value: 2.8 },
    }, PARALLAX_DYNAMICS_FIELDS);
    expect(cached.gnssSpeed?.value).toBe(10);
    expect(cached.tirePressureFrontLeft?.value).toBe(2.8);
    // After dynamics stops, newer legacy data remains usable.
    mergeVehicleState(cached, { gnssSpeed: { timeStamp: nextAt, value: 0 } }, PARALLAX_DYNAMICS_FIELDS);
    expect(cached.gnssSpeed?.value).toBe(0);
  });

  it("protects compound GPS locations from delayed readings in either stream", () => {
    const current = { latitude: 34, longitude: -116, timeStamp: "2026-10-04T10:01:00Z" };
    const cached: VehicleState = { gnssLocation: current };
    mergeVehicleState(cached, {
      gnssLocation: { latitude: 35, longitude: -117, timeStamp: "2026-10-04T10:00:00Z" },
    }, PARALLAX_DYNAMICS_FIELDS);
    expect(cached.gnssLocation).toEqual(current);
  });
});
