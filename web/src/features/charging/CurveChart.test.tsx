import type { ChargingCurvePointDto, HistoryPoint } from '@server/api-types';
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
    band?: boolean;
    ownScale?: boolean | string;
    connectNulls?: boolean;
    unit?: string;
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

const reading = (minutes: number, avg: number, min: number, max: number): HistoryPoint => ({
  bucket: at(minutes),
  avg,
  min,
  max,
});

/** Cold cells warming as the charge runs: 22–27 °C, then 32–37 °C. */
const temperatures = [reading(0, 24.5, 22, 27), reading(3, 34.5, 32, 37)];

/** Forty minutes of charging, long enough for a reading's hold to run out mid-curve. */
const longCurve: ChargingCurvePointDto[] = [0, 10, 20, 30, 40].map((minute) => ({
  ts: at(minute),
  powerKw: 7,
  soc: 40 + minute / 2,
}));
/** The pack read at the start, the route's mark that it stopped being heard, and again at the end. */
const gapped = [
  reading(0, 24.5, 22, 27),
  { bucket: at(15), avg: null, min: null, max: null },
  reading(40, 34.5, 32, 37),
];

function render(props: Partial<Parameters<typeof CurveChart>[0]>, temperature: 'F' | 'C' = 'F') {
  const client = new QueryClient();
  client.setQueryData(['units'], { distance: 'mi', temperature });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <CurveChart curve={curve} loading={false} {...props} />
    </QueryClientProvider>,
  );
}

const lastChart = () => charts.at(-1)!;
const seriesOf = (key: string) => lastChart().series.find((s) => s.key === key);

beforeEach(() => {
  charts.length = 0;
});

describe('CurveChart with the pack temperature recorded', () => {
  it('draws the band and the average line over it, on their own scale', () => {
    render({ temperatures });

    expect(lastChart().series.map((s) => s.key)).toEqual([
      'power',
      'soc',
      'packRange',
      'packAverage',
    ]);
    const band = seriesOf('packRange')!;
    expect(band.band).toBe(true);
    // One hidden axis for both, so the line sits inside its own band.
    expect(band.ownScale).toBe('pack');
    expect(seriesOf('packAverage')!.ownScale).toBe('pack');
    // A silence in the readings is a break, not a straight line across it.
    expect(seriesOf('packAverage')!.connectNulls).toBe(false);
  });

  it('draws them in the unit the owner reads, from the readings held so far', () => {
    render({ temperatures });

    expect(seriesOf('packRange')!.unit).toBe('°F');
    expect(seriesOf('packAverage')!.unit).toBe('°F');
    expect(lastChart().data.map((row) => row.packRange)).toEqual([
      [71.6, 80.6],
      [71.6, 80.6],
      [71.6, 80.6],
      [89.6, 98.6],
      [89.6, 98.6],
    ]);
    expect(lastChart().data.map((row) => row.packAverage)).toEqual([76.1, 76.1, 76.1, 94.1, 94.1]);
  });

  it('leaves the pack out of the curve where the recorder went quiet', () => {
    // The route marks a silence where the vehicle stopped being heard, so the
    // band and the line stop there rather than reach across to the next reading.
    render({ curve: longCurve, temperatures: gapped }, 'C');

    expect(lastChart().data.map((row) => row.packAverage)).toEqual([24.5, 24.5, null, null, 34.5]);
    expect(lastChart().data.map((row) => row.packRange)).toEqual([
      [22, 27],
      [22, 27],
      null,
      null,
      [32, 37],
    ]);
  });

  it('leaves the readings in celsius for an owner who reads celsius', () => {
    render({ temperatures }, 'C');

    expect(seriesOf('packRange')!.unit).toBe('°C');
    expect(lastChart().data[0]!.packRange).toEqual([22, 27]);
  });

  it('frames the pack’s scale, and leaves power and battery to fit themselves', () => {
    render({ temperatures });

    // The readings run 71.6 to 98.6 °F, framed on the whole tens around them,
    // so the band keeps to a third of the plot instead of filling it.
    expect(lastChart().ownDomains?.pack).toEqual([40, 140]);
    expect(lastChart().leftDomain).toEqual([0, 'auto']);
    expect(lastChart().rightDomain).toEqual([0, 100]);
  });

  it('frames the pack’s own unit, not the one the power is read in', () => {
    render({ temperatures }, 'C');

    // 22 to 37 °C: a fifteen-degree session in a frame of fifty, centred on it
    // and snapped out to whole fives.
    expect(lastChart().ownDomains?.pack).toEqual([0, 55]);
  });
});

describe('CurveChart without a pack temperature', () => {
  it('draws power and battery only', () => {
    render({});

    expect(lastChart().series.map((s) => s.key)).toEqual(['power', 'soc']);
    expect(lastChart().data.every((row) => row.packRange == null)).toBe(true);
    expect(lastChart().data.every((row) => row.packAverage == null)).toBe(true);
  });

  it('draws no chart at all without a curve', () => {
    render({ curve: [], temperatures });

    expect(charts).toHaveLength(0);
  });
});
