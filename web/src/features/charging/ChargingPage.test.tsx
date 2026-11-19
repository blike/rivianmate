// @vitest-environment jsdom
import type { ChargingCurvePointDto, HistoryPoint } from '@server/api-types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { cloneElement, type ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ID, parkedState, sessions } from '../../testing/fixtures';
import { ChargingPage } from './ChargingPage';

/** jsdom lays nothing out, so give the charts their containers' size. */
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({
      children,
    }: {
      children: ReactElement<{ width?: number; height?: number }>;
    }) => cloneElement(children, { width: 800, height: 260 }),
  };
});

const session = sessions[0]!;
const MIN = 60_000;
const SHOWING = Date.parse(session.chargingStartedAt!);
const ENDED = Date.parse(session.chargingEndedAt!);
const at = (ms: number) => new Date(ms).toISOString();

const curve: ChargingCurvePointDto[] = [
  { ts: at(SHOWING), powerKw: 10.4, soc: 40 },
  { ts: at(SHOWING + 60 * MIN), powerKw: 10.8, soc: 52 },
  { ts: at(ENDED), powerKw: 9.6, soc: 82 },
];

const packTemps: HistoryPoint[] = [
  { bucket: at(SHOWING), avg: 20, min: 19, max: 21 },
  { bucket: at(SHOWING + 60 * MIN), avg: 22, min: 21, max: 23 },
  { bucket: at(ENDED), avg: 24, min: 23, max: 25 },
];

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData(['units'], { distance: 'mi', temperature: 'F' });
  client.setQueryData(['vehicleState', ID], parkedState);
  client.setQueryData(['liveCharging', ID], null);
  client.setQueryData(['chargingSessions', ID, 'pages'], {
    pages: [sessions],
    pageParams: [{}],
  });
  client.setQueryData(['chargingCurve', ID, session.id], curve);
  client.setQueryData(['packTemps', ID, 'charge', session.id, session.chargingEndedAt], packTemps);
  client.setQueryData(['chargingCoverage', ID], { since: null });
  client.setQueryData(['wallboxes'], []);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ChargingPage vehicleId={ID} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const legends = (container: HTMLElement) =>
  [...container.querySelectorAll('.recharts-legend-item')].map((item) => item.textContent);

describe('ChargingPage', () => {
  it('draws the pack’s temperature as its own chart under the curve', () => {
    const { container } = renderPage();
    const page = container.textContent ?? '';

    expect(page).toContain('Charging curve');
    expect(page).toContain('Pack temperature');
    expect(page).toContain('At start');
    expect(page).toContain('At end');
    expect(page).toContain('Change');
    expect(page).toContain('68.0 °F');
    expect(page).toContain('75.2 °F');
  });

  it('leaves the curve to power and battery, and legends the pack once', () => {
    const { container } = renderPage();

    expect(legends(container)).toEqual(['Battery', 'Power', 'Average pack temperature']);
  });
});
