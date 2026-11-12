// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { cloneElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TrendChart } from './TrendChart';

/**
 * jsdom lays nothing out, so the chart is handed the size its container would
 * give it. Everything below that is drawn for real.
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

const PACK = 'var(--series-3)';
/** Minutes the car was quiet for, so there was nothing to read. */
const quiet = (minute: number) => minute === 2 || minute === 5;

const rows = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((minute) => ({
  minutes: minute,
  packRange: quiet(minute) ? null : ([20 + minute, 26 + minute] as [number, number]),
  packAverage: quiet(minute) ? null : 23 + minute,
}));

const series = [
  {
    key: 'packRange',
    label: 'Pack range',
    color: PACK,
    band: true,
    interpolation: 'linear' as const,
    ownScale: 'pack',
  },
  {
    key: 'packAverage',
    label: 'Pack average',
    color: PACK,
    mark: 'line' as const,
    interpolation: 'linear' as const,
    connectNulls: false,
    ownScale: 'pack',
  },
];

const draw = (data: typeof rows) =>
  render(<TrendChart data={data} xKey="minutes" series={series} />);

const drawn = (container: HTMLElement, selector: string) =>
  [...container.querySelectorAll(selector)].map((path) => path.getAttribute('d') ?? '');

/** The stretches a path draws: each `M` starts one. */
const stretches = (path: string) => (path.match(/M/g) ?? []).length;

describe('a band series', () => {
  it('fills the span between its ends, with the line drawn over it', () => {
    const { container } = draw(rows);

    const [band] = container.querySelectorAll('.recharts-area-area');
    expect(band?.getAttribute('fill')).toBe(PACK);
    expect(Number(band?.getAttribute('fill-opacity'))).toBeLessThan(0.5);
    const [average] = container.querySelectorAll('.recharts-line-curve');
    expect(average?.getAttribute('stroke')).toBe(PACK);
  });

  it('breaks the band and the line where nothing was read, and picks up after', () => {
    const { container } = draw(rows);

    // Three stretches of readings, so three of drawing.
    expect(stretches(drawn(container, '.recharts-area-area')[0]!)).toBe(3);
    expect(stretches(drawn(container, '.recharts-line-curve')[0]!)).toBe(3);
  });

  it('draws nothing where nothing was read', () => {
    const { container } = draw(rows.map((row) => ({ ...row, packRange: null, packAverage: null })));

    expect(drawn(container, '.recharts-area-area')).toEqual([]);
    expect(drawn(container, '.recharts-line-curve')).toEqual([]);
  });
});
