// @vitest-environment jsdom
import type { DriveDetailDto, HistoryPoint } from '@server/api-types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as renderDom } from '@testing-library/react';
import { cloneElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { PackTempSpan } from '../api/hooks';
import { packReadings, packTempChartSeries, packTempSeries } from '../lib/packTemperature';
import { unitFormatter } from '../lib/units';
import { ID } from '../testing/fixtures';
import { PackTempSection } from './PackTempSection';
import { TrendTooltip, tooltipRows } from './TrendChart';

/** jsdom lays nothing out, so give the chart its container's size. */
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

const drive = (over: Partial<DriveDetailDto> = {}): DriveDetailDto =>
  ({
    id: 2,
    startedAt: at(0),
    endedAt: at(60),
    points: [],
    ...over,
  }) as DriveDetailDto;

/** History as the route returns it: the average, the coldest and hottest cell. */
const rows = (
  readings: [minutes: number, avgC: number, minC: number, maxC: number][],
): HistoryPoint[] =>
  readings.map(([minutes, avg, min, max]) => ({
    bucket: at(minutes),
    avg,
    min,
    max,
  }));

function renderSpan(
  span: PackTempSpan | undefined,
  history: object[] = [],
  vehicle: { vehicleId?: string; insights?: object } = {},
) {
  const vehicleId = vehicle.vehicleId ?? ID;
  const client = new QueryClient();
  client.setQueryData(['units'], { distance: 'mi', temperature: 'F' });
  if (vehicle.insights) client.setQueryData(['insights', vehicleId], vehicle.insights);
  if (span)
    client.setQueryData(['packTemps', vehicleId, span.kind, span.id, span.to ?? 'live'], history);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <PackTempSection vehicleId={vehicleId} span={span} loading={false} />
    </QueryClientProvider>,
  );
}

/** A drive's own window, as the drive page reads it. */
const spanOf = (d: DriveDetailDto): PackTempSpan => ({
  kind: 'drive',
  id: d.id,
  from: d.startedAt,
  to: d.endedAt,
});

const render = (d: DriveDetailDto | undefined, history: object[] = []) =>
  renderSpan(d && spanOf(d), history);

/** A charge's window is its charging, not the whole plug-in. */
const chargeSpan: PackTempSpan = { kind: 'charge', id: 7, from: at(0), to: at(60) };

describe('PackTempSection', () => {
  it('shows the temperature at each end and the change between them', () => {
    const html = render(
      drive(),
      rows([
        [0, 20, 19, 21],
        [30, 21, 20, 22],
        [60, 23, 22, 24],
      ]),
    );
    expect(html).toContain('Pack temperature');
    expect(html).toContain('At start');
    expect(html).toContain('At end');
    // 20 °C and 23 °C, and three degrees of change.
    expect(html).toContain('68.0 °F');
    expect(html).toContain('73.4 °F');
    expect(html).toContain('+5.4 °F');
    expect(html).toContain('over 1h 0m');
  });

  it('draws the line and the band it sits in', () => {
    const html = render(
      drive(),
      rows([
        [0, 20, 19, 21],
        [60, 23, 22, 24],
      ]),
    );
    expect(html).toContain('recharts-wrapper');
    expect(html).not.toContain('No pack temperature was recorded');
  });

  it('shows the end it has and leaves the other unknown when readings stop early', () => {
    const html = render(
      drive(),
      rows([
        [0, 20, 19, 21],
        [10, 21, 20, 22],
      ]),
    );
    expect(html).toContain('68.0 °F');
    expect(html).toContain('Not recorded');
    expect(html).toContain('Needs both');
    expect(html).not.toContain('+');
  });

  it('says so when the drive has no readings at all', () => {
    const html = render(drive(), []);
    expect(html).toContain('No pack temperature was recorded on this drive');
    // The figures keep their shape, with nothing in them.
    expect(html).toContain('At start');
    expect(html).toContain('—');
  });

  it('gives the awake case for a vehicle that reports these readings', () => {
    const html = renderSpan(spanOf(drive()), [], {
      insights: { cellTemps: { avgC: 20, minC: 19, maxC: 21, at: at(0) } },
    });
    expect(html).toContain('the vehicle reports it only while it’s awake');
  });

  it('says a vehicle that has never sent these readings has none, not that it was asleep', () => {
    const html = renderSpan(spanOf(drive()), [], { insights: { cellTemps: null } });
    expect(html).toContain('it isn’t reported for this vehicle');
    expect(html).not.toContain('only while it’s awake');
  });

  it('says a TeslaMate vehicle never reports them, whatever it is doing', () => {
    // The history route answers an empty series for these fields on one.
    const html = renderSpan(spanOf(drive()), [], { vehicleId: 'tm-1' });
    expect(html).toContain('it isn’t reported for this vehicle');
    expect(html).not.toContain('only while it’s awake');
  });

  it('says a single reading is no trend to draw', () => {
    const html = render(drive(), rows([[30, 21, 20, 22]]));
    expect(html).toContain('One pack temperature reading');
  });

  it('leaves an end unknown when the only reading is nowhere near it', () => {
    // A reading in the middle of the drive stands for neither end.
    const html = render(drive(), rows([[30, 21, 20, 22]]));
    expect(html).not.toContain('69.8 °F');
    expect(html).toContain('Not recorded');
  });

  it('renders the section’s shape before any span is chosen', () => {
    const html = render(undefined, []);
    expect(html).toContain('Pack temperature');
    expect(html).toContain('At end');
  });

  it('draws a charge’s window as it draws a drive’s, under the same figures', () => {
    const html = renderSpan(
      chargeSpan,
      rows([
        [0, 20, 19, 21],
        [60, 23, 22, 24],
      ]),
    );
    expect(html).toContain('Pack temperature');
    expect(html).toContain('recharts-wrapper');
    // 20 °C and 23 °C, and the three degrees between them.
    expect(html).toContain('68.0 °F');
    expect(html).toContain('73.4 °F');
    expect(html).toContain('+5.4 °F');
  });

  it('names a charge, not a drive, when it has no readings to draw', () => {
    const html = renderSpan(chargeSpan, []);
    expect(html).toContain('No pack temperature was recorded on this charge');
    expect(html).not.toContain('on this drive');
  });

  it('says a single charge reading is no trend to draw', () => {
    const html = renderSpan(chargeSpan, rows([[30, 21, 20, 22]]));
    expect(html).toContain('One pack temperature reading was recorded on this charge');
  });

  it('names the band’s edges and the pack’s average in the tooltip, with their values', () => {
    const u = unitFormatter({ distance: 'mi', temperature: 'F' });
    const readings = packReadings(
      rows([
        [0, 20, 19, 21],
        [60, 23, 22, 24],
      ]),
    );
    const series = packTempChartSeries(u);
    const [first] = packTempSeries(readings, {
      startMs: START,
      endMs: START + 60 * MIN,
      toDisplay: u.temperature,
    });
    const listed = tooltipRows(series, first!);

    // The hottest cell first, then the pack's average, then the coldest.
    expect(listed.map((row) => row.series.label)).toEqual([
      'Max cell temperature',
      'Average pack temperature',
      'Min cell temperature',
    ]);

    const tooltip = renderDom(<TrendTooltip title="2:00 PM" rows={listed} />);
    const said = (label: string) => tooltip.getByText(label).parentElement?.textContent;
    // 21, 20 and 19 °C, in the owner's unit and the series' precision.
    expect(said('Max cell temperature')).toBe('Max cell temperature69.8°F');
    expect(said('Average pack temperature')).toBe('Average pack temperature68.0°F');
    expect(said('Min cell temperature')).toBe('Min cell temperature66.2°F');
    // The band is the picture, not a figure: no range is listed beside it.
    expect(tooltip.queryByText('Coldest to hottest cell')).toBeNull();
    expect(tooltip.container.textContent).not.toContain('–');
  });
});

const FLAT: HistoryPoint[] = (
  [
    [0, 20.6, 20.1, 21.1],
    [30, 21.6, 21.1, 22.1],
    [60, 22.6, 22.1, 23.1],
  ] as const
).map(([minutes, avg, min, max]) => ({ bucket: at(minutes), avg, min, max }));

/**
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

const SPANS: [name: string, span: PackTempSpan][] = [
  ['a drive', DRIVE],
  ['a charge', CHARGE],
];

function draw(span: PackTempSpan, history: HistoryPoint[] = FLAT) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData(['units'], { distance: 'mi', temperature: 'F' });
  client.setQueryData(['packTemps', ID, span.kind, span.id, span.to ?? 'live'], history);
  return renderDom(
    <QueryClientProvider client={client}>
      <PackTempSection vehicleId={ID} span={span} loading={false} />
    </QueryClientProvider>,
  );
}

const ticks = (container: HTMLElement) =>
  [
    ...container.querySelectorAll(
      '.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value',
    ),
  ].map((tick) => Number.parseFloat(tick.textContent ?? ''));

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
    expect(high - low).toBeGreaterThanOrEqual(20);
    expect((fahrenheit(23.1) - fahrenheit(20.1)) / (high - low)).toBeLessThanOrEqual(1 / 3);
    expect(low).toBeLessThanOrEqual(fahrenheit(20.1));
    expect(high).toBeGreaterThanOrEqual(fahrenheit(23.1));
  });

  it('ticks a narrow axis every five degrees, so its labels are evenly spaced', () => {
    const { container } = draw(span, QUIET);

    const ticked = ticks(container);
    expect(ticked).toEqual([55, 60, 65, 70, 75, 80]);
    expect(steps(ticked)).toEqual([5, 5, 5, 5, 5]);
  });

  it('ticks a wide axis every ten degrees, so its labels are evenly spaced', () => {
    const { container } = draw(span, LONG_CHARGE);

    const ticked = ticks(container);
    expect(ticked).toEqual([40, 50, 60, 70, 80, 90, 100]);
    expect(steps(ticked)).toEqual([10, 10, 10, 10, 10, 10]);
  });
});
