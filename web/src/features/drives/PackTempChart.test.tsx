// @vitest-environment jsdom
import type { HistoryPoint } from '@server/api-types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { cloneElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { PackTempSpan } from '../../api/hooks';
import { tooltipRows } from '../../components/TrendChart';
import { packReadings } from '../../lib/packTemperature';
import { unitFormatter } from '../../lib/units';
import { ID } from '../../testing/fixtures';
import { packTempChartSeries, packTempSeries } from './packTemp';
import { PackTempSection } from './PackTempSection';

/**
 * jsdom lays nothing out, so the chart is handed the size its container would
 * give it. Everything below that is drawn for real, which is what lets the
 * legend and the axis be read off it.
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

const START = Date.parse('2026-10-12T14:00:00Z');
const MIN = 60_000;
const at = (minutes: number) => new Date(START + minutes * MIN).toISOString();

/** The pack warming four degrees over an hour: a span that barely moves it. */
const FLAT: HistoryPoint[] = (
  [
    [0, 20.6, 20.1, 21.1],
    [30, 21.6, 21.1, 22.1],
    [60, 22.6, 22.1, 23.1],
  ] as const
).map(([minutes, avg, min, max]) => ({ bucket: at(minutes), avg, min, max }));

/**
 * Two sessions either side of the span where the ticks change: the quiet one
 * moves the band two degrees Fahrenheit, the long charge twenty-two.
 */
const QUIET: HistoryPoint[] = (
  [
    [0, 18.5, 18, 19],
    [60, 18.5, 18, 19],
  ] as const
).map(([minutes, avg, min, max]) => ({ bucket: at(minutes), avg, min, max }));

const LONG_CHARGE: HistoryPoint[] = (
  [
    [0, 12, 10, 14],
    [30, 20, 18, 22],
    [60, 28, 26, 30],
  ] as const
).map(([minutes, avg, min, max]) => ({ bucket: at(minutes), avg, min, max }));

const DRIVE: PackTempSpan = { kind: 'drive', id: 2, from: at(0), to: at(60) };
const CHARGE: PackTempSpan = { kind: 'charge', id: 7, from: at(0), to: at(60) };

/** Both pages draw the one chart, so every case is run through both spans. */
const SPANS: [name: string, span: PackTempSpan][] = [
  ['a drive', DRIVE],
  ['a charge', CHARGE],
];

function draw(span: PackTempSpan, history: HistoryPoint[] = FLAT) {
  const client = new QueryClient({
    // Nothing is fetched: the span's readings are put in the cache as read.
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData(['units'], { distance: 'mi', temperature: 'F' });
  client.setQueryData(['packTemps', ID, span.kind, span.id, span.to ?? 'live'], history);
  return render(
    <QueryClientProvider client={client}>
      <PackTempSection vehicleId={ID} span={span} loading={false} />
    </QueryClientProvider>,
  );
}

/** The temperatures the chart's own axis is ticked with, in the unit read. */
const ticks = (container: HTMLElement) =>
  [
    ...container.querySelectorAll(
      '.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value',
    ),
  ].map((tick) => Number.parseFloat(tick.textContent ?? ''));

/** The gaps between those ticks, as the chart drew them. */
const steps = (ticked: number[]) =>
  ticked.slice(1).map((value, i) => Number((value - ticked[i]!).toFixed(2)));

const fahrenheit = (celsius: number) => celsius * 1.8 + 32;

describe.each(SPANS)('the pack temperature chart on %s', (_name, span) => {
  it('lists the pack’s average once, and the band not at all', () => {
    const { container } = draw(span);

    const legend = [...container.querySelectorAll('.recharts-legend-item')].map(
      (item) => item.textContent,
    );
    expect(legend).toEqual(['Average pack temperature']);
    expect(container.textContent).not.toContain('Coldest to hottest cell');
  });

  it('names the three figures it is drawn from in the tooltip', () => {
    const u = unitFormatter({ distance: 'mi', temperature: 'F' });
    const series = packTempChartSeries(u);
    const [first] = packTempSeries(packReadings(FLAT), {
      startMs: START,
      endMs: START + 60 * MIN,
      toDisplay: u.temperature,
    });

    expect(tooltipRows(series, first!).map((row) => row.series.label)).toEqual([
      'Max cell temperature',
      'Average pack temperature',
      'Min cell temperature',
    ]);
  });

  it('frames the axis around a span that barely moves the pack, rather than fitting it', () => {
    const { container } = draw(span);

    const ticked = ticks(container);
    const low = ticked[0]!;
    const high = ticked.at(-1)!;
    // Ten degrees of air each side of readings that span five, snapped out to
    // whole steps: 50 to 90.
    expect(high - low).toBeGreaterThanOrEqual(20);
    // So the readings fill a fraction of the height, not the plot.
    expect((fahrenheit(23.1) - fahrenheit(20.1)) / (high - low)).toBeLessThanOrEqual(1 / 3);
    expect(low).toBeLessThanOrEqual(fahrenheit(20.1));
    expect(high).toBeGreaterThanOrEqual(fahrenheit(23.1));
  });

  it('ticks a narrow axis every five degrees, so its labels are evenly spaced', () => {
    const { container } = draw(span, QUIET);

    const ticked = ticks(container);
    // 18 to 19 °C, framed 55 to 80 °F on the 5 °F grid: six labels, five apart.
    expect(ticked).toEqual([55, 60, 65, 70, 75, 80]);
    expect(steps(ticked)).toEqual([5, 5, 5, 5, 5]);
  });

  it('ticks a wide axis every ten degrees, so its labels are evenly spaced', () => {
    const { container } = draw(span, LONG_CHARGE);

    const ticked = ticks(container);
    // 10 to 30 °C, framed 40 to 100 °F: seven labels, ten apart.
    expect(ticked).toEqual([40, 50, 60, 70, 80, 90, 100]);
    expect(steps(ticked)).toEqual([10, 10, 10, 10, 10, 10]);
  });
});
