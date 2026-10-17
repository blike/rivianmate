import { describe, expect, it } from 'vitest';
import {
  type SavedLocation,
  estimateCost,
  homeSpots,
  nearbySpot,
  sessionPlace,
  sessionRate,
} from './locations.js';

const HOME = { lat: 40.5142, lon: -88.9906 };
/** About 111 m of latitude per 0.001°. */
const north = (m: number) => ({ lat: HOME.lat + m / 111_000, lon: HOME.lon });

const place = (over: Partial<SavedLocation> = {}): SavedLocation => ({
  id: 1,
  name: 'Home',
  ...HOME,
  radiusM: 150,
  isHome: true,
  ratePerKwh: 0.15,
  ...over,
});
const facts = (over = {}) => ({
  isPublic: null,
  isHomeCharger: null,
  chargerType: null,
  lat: null,
  lon: null,
  ...over,
});

describe('nearbySpot', () => {
  it('matches within each spot’s own radius', () => {
    const small = place({ radiusM: 50 });
    const large = place({ radiusM: 500 });
    expect(nearbySpot(north(100).lat, HOME.lon, [small])).toBeNull();
    expect(nearbySpot(north(100).lat, HOME.lon, [large])).toBe(large);
    expect(nearbySpot(north(160).lat, HOME.lon, [HOME])).toBeNull(); // default 150 m
    expect(nearbySpot(null, null, [large])).toBeNull();
  });

  it('prefers the area the point is deepest inside', () => {
    const campus = place({ id: 1, name: 'Campus', radiusM: 1000 });
    const garage = place({ id: 2, name: 'Garage', ...north(300), radiusM: 60 });
    expect(nearbySpot(north(310).lat, HOME.lon, [campus, garage])?.name).toBe('Garage');
    expect(nearbySpot(north(100).lat, HOME.lon, [campus, garage])?.name).toBe('Campus');
  });
});

describe('sessionPlace', () => {
  const work = place({ id: 2, name: 'Work', isHome: false, ratePerKwh: 0, ...north(5000) });

  it("trusts Rivian's home flag and wallbox type", () => {
    expect(sessionPlace(facts({ isHomeCharger: true }), [], []).isHome).toBe(true);
    expect(sessionPlace(facts({ chargerType: 'wallbox' }), [], []).isHome).toBe(true);
  });

  it('names the location and counts it as home only when marked', () => {
    expect(sessionPlace(facts(north(50)), [place(), work], [])).toEqual({
      location: place(),
      isHome: true,
    });
    expect(sessionPlace(facts(north(5000)), [place(), work], [])).toEqual({
      location: work,
      isHome: false,
    });
  });

  it('counts a session near a wallbox as home, outside any location', () => {
    expect(sessionPlace(facts(north(50)), [], [HOME])).toEqual({ location: null, isHome: true });
  });

  it('keeps the location of a public charger, but never calls it home', () => {
    const at = sessionPlace(
      facts({ isPublic: true, isHomeCharger: true, ...HOME }),
      [place()],
      [HOME],
    );
    expect(at).toEqual({ location: place(), isHome: false });
  });
});

describe('sessionRate', () => {
  const work = place({ id: 2, name: 'Work', isHome: false, ratePerKwh: 0 });

  it("uses the location's rate, else the home rate for home charging", () => {
    expect(sessionRate({ location: work, isHome: false }, [place(), work])).toBe(0);
    // A Wall Charger session with no position, as Rivian's history can have.
    expect(sessionRate({ location: null, isHome: true }, [work, place()])).toBe(0.15);
    expect(sessionRate({ location: null, isHome: false }, [place()])).toBeNull();
    expect(sessionRate({ location: null, isHome: true }, [work])).toBeNull();
  });
});

describe('estimateCost', () => {
  it('multiplies energy by rate and rounds to cents', () => {
    expect(estimateCost(55, 0.137)).toBe('7.54');
    expect(estimateCost(55, 0)).toBe('0.00');
    expect(estimateCost(55, null)).toBeNull();
    expect(estimateCost(null, 0.15)).toBeNull();
    expect(estimateCost(0, 0.15)).toBeNull();
  });
});

describe('homeSpots', () => {
  it('combines wallboxes with home locations only', () => {
    const home = place();
    const spots = homeSpots(
      [home, place({ id: 2, name: 'Work', isHome: false })],
      [
        { latitude: 3, longitude: 4 },
        { latitude: null, longitude: null },
      ],
    );
    expect(spots).toEqual([{ lat: 3, lon: 4 }, home]);
  });
});
