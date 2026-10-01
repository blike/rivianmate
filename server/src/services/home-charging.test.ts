import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOME_CHARGING,
  estimateHomeCost,
  homeSpots,
  isHomeSession,
  nearbySpot,
} from "./home-charging.js";

const HOME = { lat: 40.5142, lon: -88.9906 };
const facts = (over = {}) => ({
  isPublic: null,
  isHomeCharger: null,
  chargerType: null,
  lat: null,
  lon: null,
  ...over,
});

describe("isHomeSession", () => {
  it("trusts Rivian's home flag and wallbox type", () => {
    expect(isHomeSession(facts({ isHomeCharger: true }), [])).toBe(true);
    expect(isHomeSession(facts({ chargerType: "wallbox" }), [])).toBe(true);
  });

  it("uses proximity to a home spot (~150 m)", () => {
    expect(isHomeSession(facts({ lat: HOME.lat + 0.0005, lon: HOME.lon }), [HOME])).toBe(true); // ~55 m
    expect(isHomeSession(facts({ lat: HOME.lat + 0.005, lon: HOME.lon }), [HOME])).toBe(false); // ~550 m
  });

  it("never treats public charging as home", () => {
    expect(isHomeSession(facts({ isPublic: true, isHomeCharger: true, lat: HOME.lat, lon: HOME.lon }), [HOME])).toBe(false);
  });
});

describe("nearbySpot", () => {
  it("returns the closest spot within range", () => {
    const near = { ...HOME, id: "a" };
    const far = { lat: HOME.lat + 0.001, lon: HOME.lon, id: "b" };
    expect(nearbySpot(HOME.lat + 0.0002, HOME.lon, [far, near])?.id).toBe("a");
    expect(nearbySpot(null, null, [near])).toBeNull();
  });
});

describe("estimateHomeCost", () => {
  it("multiplies energy by rate and rounds to cents", () => {
    expect(estimateHomeCost(55, 0.137)).toBe("7.54");
    expect(estimateHomeCost(55, null)).toBeNull();
    expect(estimateHomeCost(null, 0.15)).toBeNull();
    expect(estimateHomeCost(0, 0.15)).toBeNull();
  });
});

describe("homeSpots", () => {
  it("combines wallboxes with the configured home location", () => {
    const spots = homeSpots(
      { ...DEFAULT_HOME_CHARGING, homeLat: 1, homeLon: 2 },
      [{ latitude: 3, longitude: 4 }, { latitude: null, longitude: null }],
    );
    expect(spots).toEqual([{ lat: 3, lon: 4 }, { lat: 1, lon: 2 }]);
  });
});
