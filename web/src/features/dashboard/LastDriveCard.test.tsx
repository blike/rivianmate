import type { DriveDto } from '@server/api-types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { Navigation } from '../../lib/navigation';
import { LastDriveCard } from './LastDriveCard';

const now = Date.parse('2026-10-28T21:40:00Z');

const drive = {
  id: 7,
  startedAt: '2026-10-28T21:15:00Z',
  endedAt: null,
  distanceKm: 26.9,
  startBattery: 58,
  endBattery: 55,
  destination: null,
  start: {
    label: 'West Zoo Road, San Diego',
    address: null,
    isHome: false,
    locationId: null,
    unnamed: false,
  },
  end: null,
} as unknown as DriveDto;

const stop = (name: string, remainingKm: number, remainingS: number, etaAt: string) => ({
  name,
  lat: 33,
  lon: -117,
  remainingKm,
  remainingS,
  etaAt,
});

// On the way to Menchie's, then home.
const navigation: Navigation = {
  destination: { name: 'Home', lat: 33, lon: -117 },
  totalDistanceKm: null,
  totalDurationS: null,
  arrivalSoc: 53,
  arrivalRangeKm: null,
  etaAt: '2026-10-28T22:00:00Z',
  route: null,
  remainingKm: 8.7,
  remainingS: 960,
  stops: [
    stop("Menchie's Frozen Yogurt", 3.2, 480, '2026-10-28T21:48:00Z'),
    stop('Home', 8.7, 960, '2026-10-28T22:00:00Z'),
  ],
  at: '2026-10-28T21:40:00Z',
};

const render = (nav: Navigation) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <LastDriveCard drive={drive} now={now} speedMps={14} navigation={nav} navigationLoaded />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('LastDriveCard', () => {
  it("leads with the next stop's figures, then the destination's, numbered as on the bar", () => {
    const html = render(navigation);
    expect(html).toContain('Menchie&#x27;s Frozen Yogurt');
    expect(html).toContain('+1 stop');
    expect(html).toContain('to next · ');
    expect(html).toContain('8 min');
    expect(html).toContain('53%');
    // Numbered on the bar and in the labels: 1 for Menchie's, 2 for home.
    expect(html).toContain('title="Menchie&#x27;s Frozen Yogurt"');
    expect(html).toContain('title="Home"');
    expect(html.match(/>2<\/span>/g)).toHaveLength(2);
  });

  it('keeps the plain figures for a single destination', () => {
    const html = render({ ...navigation, stops: [navigation.stops[1]!] });
    expect(html).toContain('>Arrives<');
    expect(html).toContain('>Time left<');
    expect(html).toContain('>Arrival battery<');
    expect(html).not.toContain('to next');
    expect(html).not.toContain('+1 stop');
  });
});
