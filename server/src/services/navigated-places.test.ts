import { describe, expect, it } from 'vitest';
import { navigatedName } from './navigated-places.js';

const drive = (over: Partial<Parameters<typeof navigatedName>[0]> = {}) => ({
  destinationName: 'Sonic Drive-In',
  destinationLat: 34.1286,
  destinationLon: -116.3945,
  endLat: 34.1285,
  endLon: -116.3947,
  endPlace: '58145 29 Palms Highway, Yucca Valley',
  ...over,
});

describe('navigatedName', () => {
  it('names a drive that parked where navigation was headed', () => {
    expect(navigatedName(drive())).toBe('Sonic Drive-In');
  });

  it('gives a place with no house number more room, as its pin can be far from the spot', () => {
    // A campsite 1.7 km from the campground's pin.
    const camp = drive({
      destinationName: 'Jumbo Rocks Campground',
      destinationLat: 33.9917,
      destinationLon: -116.0628,
      endLat: 34.0031,
      endLon: -116.0511,
      endPlace: 'Park Boulevard, Riverside County',
    });
    expect(navigatedName(camp)).toBe('Jumbo Rocks Campground');
    // Somewhere numbered 1.7 km short is somewhere else.
    expect(navigatedName({ ...camp, endPlace: '749 Almond Road, San Marcos' })).toBeNull();
    // Nor is the trailhead 11 km away where it parked.
    expect(
      navigatedName({ ...camp, destinationLat: 34.0125, destinationLon: -116.1681 }),
    ).toBeNull();
  });

  it('leaves out addresses, and a destination it never reached', () => {
    expect(navigatedName(drive({ destinationName: '2412 La Pluma Ln' }))).toBeNull();
    expect(navigatedName(drive({ destinationLat: 33.07, destinationLon: -117.25 }))).toBeNull();
    expect(navigatedName(drive({ destinationName: null }))).toBeNull();
    expect(navigatedName(drive({ endLat: null }))).toBeNull();
  });

  it('puts a charging network first', () => {
    expect(
      navigatedName(drive({ destinationName: 'Joshua Tree, CA [Rivian Adventure Network]' })),
    ).toBe('Rivian Adventure Network · Joshua Tree');
  });
});
