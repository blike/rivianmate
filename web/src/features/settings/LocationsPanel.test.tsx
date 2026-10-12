import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SavedLocation } from '../../api/client';
import { parseRate } from './LocationEditor';
import { LocationsPanel } from './LocationsPanel';

const render = (locations: SavedLocation[]) => {
  const client = new QueryClient();
  client.setQueryData(['savedLocations'], locations);
  client.setQueryData(['chargingSettings'], { currency: 'USD' });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <LocationsPanel vehicleId={undefined} />
    </QueryClientProvider>,
  );
};

describe('LocationsPanel', () => {
  it('lists each location with its rate and area', () => {
    const html = render([
      { id: 1, name: 'Home', lat: 33, lon: -117, radiusM: 150, isHome: true, ratePerKwh: 0.131 },
      { id: 2, name: 'Work', lat: 33.1, lon: -117.3, radiusM: 300, isHome: false, ratePerKwh: 0 },
    ]);
    expect(html).toContain('Home');
    expect(html).toContain('$0.131/kWh');
    expect(html).toContain('Work');
    expect(html).toContain('Free');
  });

  it('invites adding one when there are none', () => {
    expect(render([])).toContain('No locations yet');
  });
});

describe('parseRate', () => {
  it('reads empty as no rate and allows free', () => {
    expect(parseRate('')).toEqual({ rate: null, invalid: false });
    expect(parseRate('0')).toEqual({ rate: 0, invalid: false });
    expect(parseRate('0.131')).toEqual({ rate: 0.131, invalid: false });
    expect(parseRate('-1').invalid).toBe(true);
    expect(parseRate('abc').invalid).toBe(true);
    expect(parseRate('11').invalid).toBe(true);
  });
});
