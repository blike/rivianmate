import { describe, expect, it } from 'vitest';
import type { PlaceContext } from './charging.js';
import { coordinatesLabel, drivePlace } from './history.js';

const HOME = { lat: 33.0714, lon: -117.2567 };
const WORK = { lat: 33.13, lon: -117.32 };
const places = (over: Partial<PlaceContext> = {}): PlaceContext => ({
  settings: { currency: 'USD' },
  locations: [
    { id: 1, name: 'Home', ...HOME, radiusM: 150, isHome: true, ratePerKwh: 0.13 },
    { id: 2, name: 'Work', ...WORK, radiusM: 200, isHome: false, ratePerKwh: 0 },
  ],
  wallboxes: [],
  addressLookups: true,
  ...over,
});

describe('drivePlace', () => {
  it("uses a saved location's name over the address", () => {
    expect(drivePlace(WORK.lat, WORK.lon, '1 Main St, Carlsbad', 'full', places())).toEqual({
      label: 'Work',
      address: 'full',
      isHome: false,
      locationId: 2,
      unnamed: false,
    });
    expect(drivePlace(HOME.lat, HOME.lon, null, null, places())).toMatchObject({
      label: 'Home',
      isHome: true,
      locationId: 1,
    });
  });

  it('calls a wallbox outside any location Home, and anywhere else by its address', () => {
    const wallboxOnly = places({ locations: [], wallboxes: [HOME] });
    expect(drivePlace(HOME.lat, HOME.lon, '2 Elm St', null, wallboxOnly)).toMatchObject({
      label: 'Home',
      isHome: true,
      locationId: null,
    });
    expect(drivePlace(40, -100, '2 Elm St', null, places())).toMatchObject({
      label: '2 Elm St',
      isHome: false,
    });
    expect(drivePlace(40, -100, null, null, places())).toBeNull();
  });

  it('shows the coordinates of an unnamed place while address lookups are off', () => {
    const off = places({ addressLookups: false });
    expect(drivePlace(40, -100, null, null, off)).toEqual({
      label: '40.0000°N 100.0000°W',
      address: null,
      isHome: false,
      locationId: null,
      unnamed: true,
    });
    // Saved places and addresses looked up earlier keep their names.
    expect(drivePlace(WORK.lat, WORK.lon, null, null, off)).toMatchObject({ label: 'Work' });
    expect(drivePlace(40, -100, '2 Elm St', null, off)).toMatchObject({ label: '2 Elm St' });
    expect(drivePlace(null, null, null, null, off)).toBeNull();
  });
});

describe('coordinatesLabel', () => {
  it('names the hemispheres, to four places', () => {
    expect(coordinatesLabel(33.0714378, -117.2566376)).toBe('33.0714°N 117.2566°W');
    expect(coordinatesLabel(-33.8688, 151.2093)).toBe('33.8688°S 151.2093°E');
  });
});
