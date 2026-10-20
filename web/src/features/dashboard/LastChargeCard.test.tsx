import type { ChargingSessionDto } from '@server/api-types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { LiveCharge } from '../../lib/liveCharge';
import { LastChargeCard } from './LastChargeCard';

const now = Date.parse('2026-10-17T12:00:00Z');

// Plugged in and not charging, as TeslaMate reports a car: no charge limit.
const session = {
  id: 2,
  vehicleId: 'tm-1',
  startedAt: '2026-10-17T10:00:00Z',
  endedAt: null,
  chargingSince: null,
  chargingStartedAt: null,
  chargingEndedAt: null,
  chargingSeconds: 0,
  startSoc: 60,
  endSoc: 90,
  energyKwh: null,
  estimatedEnergyKwh: null,
  cost: null,
  estimatedCost: null,
  currency: null,
  location: null,
  isHome: true,
  chargerType: 'other',
  chargerId: 'Home',
  vendor: null,
  source: 'teslamate',
} as unknown as ChargingSessionDto;

const charge: LiveCharge = {
  soc: 90,
  limit: null,
  powerKw: null,
  rateKmh: null,
  energyKwh: null,
  rangeAddedKm: null,
  secondsLeft: null,
  finish: null,
};

const render = (props: Partial<Parameters<typeof LastChargeCard>[0]>) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <LastChargeCard session={session} now={now} charge={charge} stateLoaded {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('LastChargeCard without a reported charge limit', () => {
  it('marks the level the last charge reached, without calling this one complete', () => {
    const html = render({ lastChargedTo: 85 });
    expect(html).toContain('last charge 85%');
    expect(html).not.toContain('limit');
    expect(html).not.toContain('Completed');
  });

  it('marks a reported limit as the limit', () => {
    const html = render({ charge: { ...charge, limit: 90 }, lastChargedTo: 85 });
    expect(html).toContain('of 90% limit');
    expect(html).not.toContain('last charge');
  });
});
