import type { ChargingCurvePointDto } from '@server/api-types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CurveChart } from './CurveChart';

/**
 * The chart only asks for what it draws, so the test reads its props instead
 * of an SVG: nothing is laid out without a browser to measure in.
 */
interface CapturedChart {
  data: Record<string, number | [number, number] | null>[];
  series: {
    key: string;
    label: string;
    unit?: string;
    band?: boolean;
    ownScale?: boolean | string;
  }[];
  leftDomain?: [number | 'auto', number | 'auto'];
  rightDomain?: [number | 'auto', number | 'auto'];
  ownDomains?: Record<string, [number, number]>;
}

const { charts } = vi.hoisted(() => ({ charts: [] as CapturedChart[] }));

vi.mock('../../components/TrendChart', () => ({
  TrendChart: (props: CapturedChart) => {
    charts.push(props);
    return null;
  },
}));

const START = Date.parse('2026-11-11T20:00:00Z');
const at = (minutes: number) => new Date(START + minutes * 60_000).toISOString();

const curve: ChargingCurvePointDto[] = [0, 1, 2, 3, 4].map((minute) => ({
  ts: at(minute),
  powerKw: 7 + minute,
  soc: 40 + minute * 2,
}));

function render(props: Partial<Parameters<typeof CurveChart>[0]> = {}) {
  const client = new QueryClient();
  client.setQueryData(['units'], { distance: 'mi', temperature: 'F' });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <CurveChart curve={curve} loading={false} {...props} />
    </QueryClientProvider>,
  );
}

const lastChart = () => charts.at(-1)!;

beforeEach(() => {
  charts.length = 0;
});

describe('CurveChart', () => {
  it('draws power against battery level, each on the axis that suits it', () => {
    render();

    expect(lastChart().series.map((s) => [s.key, s.unit])).toEqual([
      ['power', 'kW'],
      ['soc', '%'],
    ]);
    expect(lastChart().leftDomain).toEqual([0, 'auto']);
    expect(lastChart().rightDomain).toEqual([0, 100]);
  });

  it('carries nothing of the pack, which has its own chart below', () => {
    render();

    // Power and level only: no temperature series, no band, no scale of its
    // own, and nothing of the pack in a row. The section below draws it.
    const chart = lastChart();
    expect(chart.series.map((s) => s.key)).toEqual(['power', 'soc']);
    expect(chart.series.some((s) => s.unit === '°C' || s.unit === '°F')).toBe(false);
    expect(chart.series.some((s) => s.band)).toBe(false);
    expect(chart.ownDomains).toBeUndefined();
    expect(Object.keys(chart.data[0]!).sort()).toEqual(['forecast', 'minutes', 'power', 'soc']);
  });

  it('draws no chart at all without a curve', () => {
    render({ curve: [] });

    expect(charts).toHaveLength(0);
  });
});
