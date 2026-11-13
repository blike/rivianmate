// @vitest-environment jsdom
import type { ChargingCurvePointDto, HistoryPoint } from '@server/api-types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { cloneElement, type ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ID, parkedState, sessions } from '../../testing/fixtures';
import { ChargingPage } from './ChargingPage';

/**
 * jsdom lays nothing out, so the charts are handed the size their containers
 * would give them. Everything below that is drawn for real.
 */
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

/** The pack warming through the charge: 20 °C at its start, 24 °C at its end. */
const packTemps: HistoryPoint[] = [
  { bucket: at(SHOWING), avg: 20, min: 19, max: 21 },
  { bucket: at(SHOWING + 60 * MIN), avg: 22, min: 21, max: 23 },
  { bucket: at(ENDED), avg: 24, min: 23, max: 25 },
];

function renderPage() {
  const client = new QueryClient({
    // Nothing is fetched: every answer the page asks for is put in the cache.
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

/** The legend entries the page draws, chart by chart, in the order drawn. */
const legends = (container: HTMLElement) =>
  [...container.querySelectorAll('.recharts-legend-item')].map((item) => item.textContent);

describe('ChargingPage', () => {
  it('draws the pack’s temperature as its own chart under the curve', () => {
    const { container } = renderPage();
    const page = container.textContent ?? '';

    expect(page).toContain('Charging curve');
    // The section the drive page draws, with the figures it carries.
    expect(page).toContain('Pack temperature');
    expect(page).toContain('At start');
    expect(page).toContain('At end');
    expect(page).toContain('Change');
    // 20 °C where the charge began and 24 °C where it ended.
    expect(page).toContain('68 °F');
    expect(page).toContain('75 °F');
  });

  it('leaves the curve to power and battery, and legends the pack once', () => {
    const { container } = renderPage();

    // Power and battery on the curve — drawn as an area and a line, so listed
    // in that order — and one entry for the temperature chart below it:
    // nothing of the pack is drawn on the curve.
    expect(legends(container)).toEqual(['Battery', 'Power', 'Average pack temperature']);
  });
});
