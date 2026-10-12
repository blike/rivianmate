import { describe, expect, it } from 'vitest';
import type { PlaceContext } from './charging.js';
import { drivePlace } from './history.js';

const HOME = { lat: 33.0714, lon: -117.2567 };
const WORK = { lat: 33.13, lon: -117.32 };
const places = (over: Partial<PlaceContext> = {}): PlaceContext => ({
  settings: { currency: 'USD' },
  locations: [
    { id: 1, name: 'Home', ...HOME, radiusM: 150, isHome: true, ratePerKwh: 0.13 },
    { id: 2, name: 'Work', ...WORK, radiusM: 200, isHome: false, ratePerKwh: 0 },
  ],
  wallboxes: [],
  ...over,
});

describe('drivePlace', () => {
  it("uses a saved location's name over the address", () => {
    expect(drivePlace(WORK.lat, WORK.lon, '1 Main St, Carlsbad', 'full', places())).toEqual({
      label: 'Work',
      address: 'full',
      isHome: false,
      locationId: 2,
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
});
