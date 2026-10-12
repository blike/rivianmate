import { describe, expect, it, vi } from 'vitest';
import { formatNominatim, geocodeKey, nominatimSearch } from './drive-places.js';

describe('formatNominatim', () => {
  it('labels a place by street address and town, keeping the full address', () => {
    expect(
      formatNominatim({
        name: 'Sigma Sigma Sigma Sorority',
        display_name:
          'Sigma Sigma Sigma Sorority, 306, West Willow Street, Normal, McLean County, Illinois, 61761, United States',
        address: {
          amenity: 'Sigma Sigma Sigma Sorority',
          house_number: '306',
          road: 'West Willow Street',
          town: 'Normal',
          county: 'McLean County',
          state: 'Illinois',
        },
      }),
    ).toEqual({
      place: '306 West Willow Street, Normal',
      address:
        'Sigma Sigma Sigma Sorority, 306, West Willow Street, Normal, McLean County, Illinois, 61761, United States',
    });
  });

  it("falls back to the place name or the address's first parts", () => {
    expect(
      formatNominatim({
        name: 'Trailhead',
        display_name: 'Trailhead, Somewhere',
        address: { county: 'Inyo County' },
      })?.place,
    ).toBe('Trailhead, Inyo County');
    expect(formatNominatim({ display_name: 'A, B, C', address: {} })?.place).toBe('A, B');
  });

  it('returns null when nothing is there', () => {
    expect(formatNominatim({ error: 'Unable to geocode' })).toBeNull();
  });
});

describe('geocodeKey', () => {
  it('rounds to ~11 m', () => {
    expect(geocodeKey(33.0714378, -117.2566376)).toBe(geocodeKey(33.07141, -117.25661));
  });
});

describe('nominatimSearch', () => {
  it('reads results as labeled points, preferring ones near a spot', async () => {
    const fetchFn = vi.fn(
      async (_url: string) =>
        new Response(
          JSON.stringify([
            {
              display_name: 'Illinois State University, Normal, Illinois',
              lat: '40.51',
              lon: '-88.99',
            },
            { display_name: 'Nowhere', lat: 'x', lon: '1' },
          ]),
        ),
    );
    const search = nominatimSearch('test', fetchFn as unknown as typeof fetch, () => 0);
    expect(await search('illinois state', { lat: 40.5, lon: -89 })).toEqual([
      { label: 'Illinois State University, Normal, Illinois', lat: 40.51, lon: -88.99 },
    ]);
    const url = new URL(fetchFn.mock.calls[0]![0]);
    expect(url.searchParams.get('q')).toBe('illinois state');
    expect(url.searchParams.get('viewbox')).toBe('-89.5,41,-88.5,40');
    expect(url.searchParams.has('bounded')).toBe(false);
  });
});
