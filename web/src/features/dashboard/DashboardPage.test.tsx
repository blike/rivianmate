import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ID, ago, drives, parkedState, sessions, vehicle } from '../../testing/fixtures';
import { DashboardPage } from './DashboardPage';

function render(state: object) {
  const client = new QueryClient();
  client.setQueryData(['vehicleState', ID], state);
  client.setQueryData(['liveCharging', ID], null);
  client.setQueryData(['insights', ID], {
    cellTemps: null,
    cellTempsCurrent: false,
    coldWeather: null,
    parkedEnergy: null,
    navigation: null,
    connectivity: null,
  });
  client.setQueryData(['drives', ID], drives);
  client.setQueryData(['chargingSessions', ID], sessions);
  client.setQueryData(['schedules', ID], { charging: [], departures: [] });
  client.setQueryData(
    ['stateSpans', ID, '24h'],
    [
      { state: 'asleep', from: ago(20), to: ago(6) },
      { state: 'driving', from: ago(5), to: ago(4.5) },
    ],
  );
  client.setQueryData(
    ['history', ID, 'battery', '24h'],
    [
      { bucket: ago(20), avg: 82 },
      { bucket: ago(4.5), avg: 78.4 },
    ],
  );
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DashboardPage vehicleId={ID} vehicle={vehicle} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DashboardPage', () => {
  it('says where the vehicle is parked, with its charge and what is open', () => {
    const html = render(parkedState);
    expect(html).toContain('Rover');
    expect(html).toContain('Parked at Home');
    expect(html).toContain('Limit 85%');
    expect(html).toContain('Frunk open');
    expect(html).toContain('Last 24 hours');
    expect(html).toContain('This week');
    expect(html).toContain('Body &amp; tires');
  });

  it('shows the charging and departure schedules', () => {
    const html = render(parkedState);
    expect(html).toContain('Charging schedule');
    expect(html).toContain('Any time');
    expect(html).toContain('Next departure');
  });

  it('flags a tire the vehicle reports low', () => {
    const html = render(parkedState);
    expect(html).toContain('LOW');
  });
});
