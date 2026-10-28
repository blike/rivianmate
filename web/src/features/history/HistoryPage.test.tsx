import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ID, ago, drives, sessions } from '../../testing/fixtures';
import { rangeWindow } from './history';
import { HistoryPage } from './HistoryPage';
import { RANGES } from './options';

function render(battery?: object) {
  const client = new QueryClient();
  // Drives and sessions are listed from the start of the default 7-day window.
  const { from, to } = rangeWindow(RANGES[0].hours, new Date());
  const since = from.toISOString();
  client.setQueryData(['drives', ID, since], drives);
  client.setQueryData(['chargingSessions', ID, since], sessions);
  client.setQueryData(['driveCoverage', ID], { since: ago(24 * 60) });
  if (battery) client.setQueryData(['batteryWindow', ID, since, to.toISOString()], battery);
  client.setQueryData(
    ['chargeSpans', ID, '7d'],
    [{ kind: 'charging', from: ago(29), to: ago(24) }],
  );
  client.setQueryData(
    ['stateSpans', ID, '7d'],
    [
      { state: 'asleep', from: ago(40), to: ago(6) },
      { state: 'driving', from: ago(5), to: ago(4.5) },
    ],
  );
  client.setQueryData(['locations', ID, '7d'], []);
  client.setQueryData(
    ['history', ID, 'battery', '7d'],
    [
      { bucket: ago(30), avg: 40 },
      { bucket: ago(22), avg: 82 },
    ],
  );
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <HistoryPage vehicleId={ID} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('HistoryPage', () => {
  // The page's window ends at the clock, so it has to hold still for the seeded keys.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date());
  });
  afterEach(() => vi.useRealTimers());

  it('reports the period, its patterns and its energy', () => {
    const html = render();
    expect(html).toContain('Last 7 days');
    expect(html).toContain('Timeline');
    expect(html).toContain('Time spent');
    expect(html).toContain('Driving rhythm');
    expect(html).toContain('Places');
    expect(html).toContain('In and out');
    // The one drive ended at Home; the one session charged there.
    expect(html).toContain('1 visit');
    expect(html).toContain('100%');
    expect(html).toContain('Used driving');
  });

  it('balances energy in against energy out', () => {
    const html = render({
      capacityKwh: 100,
      startLevel: 70,
      endLevel: 70,
      parkedLossPct: 3,
      parkedHours: 120,
    });
    expect(html).toContain('Energy in');
    expect(html).toContain('Energy out');
    expect(html).toContain('Parked');
    expect(html).not.toContain('Used driving');
  });
});
