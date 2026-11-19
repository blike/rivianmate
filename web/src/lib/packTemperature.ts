import type { HistoryPoint } from '@server/api-types';
import type { TrendSeries } from '../components/TrendChart';
import { fmt } from './state';
import type { UnitFormatter } from './units';

/** How close a reading must be to a span's start or end to stand for it: one heartbeat interval. */
export const PACK_READING_FRESH_MS = 15 * 60_000;

/** A pack temperature reading: the cell average, coldest and hottest. */
export interface PackReading {
  at: number;
  avgC: number | null;
  minC: number | null;
  maxC: number | null;
}

/** The pack's temperature at one point on a chart, in the unit shown. */
export interface PackTemperature {
  avg: number | null;
  min: number | null;
  max: number | null;
}

/** The `temp` history series as readings in time order, keeping the empty rows that break the line. */
export function packReadings(points: readonly HistoryPoint[]): PackReading[] {
  return points
    .map((p) => ({ at: Date.parse(p.bucket), avgC: p.avg, minC: p.min, maxC: p.max }))
    .filter((r) => Number.isFinite(r.at))
    .sort((a, b) => a.at - b.at);
}

/** The last reading at or before `ms`. */
function held(readings: readonly PackReading[], ms: number): PackReading | null {
  let low = 0;
  let high = readings.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (readings[middle]!.at <= ms) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found < 0 ? null : readings[found]!;
}

/** The reading in effect at each of `times` (ms), in the unit shown; nulls before the first. */
export function packTemperatures(
  readings: readonly PackReading[],
  times: readonly number[],
  toDisplay: (celsius: number | null | undefined) => number | null,
): PackTemperature[] {
  return times.map((ms) => {
    const reading = held(readings, ms);
    return {
      avg: toDisplay(reading?.avgC),
      min: toDisplay(reading?.minC),
      max: toDisplay(reading?.maxC),
    };
  });
}

const MINUTE_MS = 60_000;

export interface PackTempFigures {
  startC: number | null;
  endC: number | null;
  changeC: number | null;
  startAt: number | null;
  endAt: number | null;
}

/** The reading nearest `endMs`, if close enough to stand for it. */
function readingNear(readings: readonly PackReading[], endMs: number): PackReading | null {
  let best: PackReading | null = null;
  for (const r of readings) {
    if (Math.abs(r.at - endMs) > PACK_READING_FRESH_MS) continue;
    if (best == null || Math.abs(r.at - endMs) < Math.abs(best.at - endMs)) best = r;
  }
  return best;
}

/**
 * The pack's temperature at each end of a span and the change between them.
 * An end with no reading nearby is left unknown; a span under way ends at its
 * latest reading.
 */
export function packTempFigures(
  readings: readonly PackReading[],
  drive: { startMs: number; endMs: number; live?: boolean },
): PackTempFigures {
  const known = readings.filter((r) => r.avgC != null);
  const start = readingNear(known, drive.startMs);
  const end = drive.live ? (known.at(-1) ?? null) : readingNear(known, drive.endMs);
  const changeC = start && end && start.at !== end.at ? end.avgC! - start.avgC! : null;
  return {
    startC: start?.avgC ?? null,
    endC: end?.avgC ?? null,
    changeC,
    startAt: start?.at ?? null,
    endAt: end?.at ?? null,
  };
}

/** A row of the pack temperature chart. */
export type PackTempRow = {
  minutes: number;
  avg: number | null;
  min: number | null;
  max: number | null;
  /** `[min, max]`, as the band draws it. */
  band: [number, number] | null;
};

/** The chart's rows over the span; none with fewer than two readings. */
export function packTempSeries(
  readings: readonly PackReading[],
  options: {
    startMs: number;
    endMs: number;
    /** Minutes into the span to put rows at, e.g. another chart's; a minute apart when left out. */
    minutes?: readonly number[];
    /** °C as the unit shown. */
    toDisplay: (celsius: number | null | undefined) => number | null;
  },
): PackTempRow[] {
  const { startMs, endMs, toDisplay } = options;
  if (endMs <= startMs || readings.filter((r) => r.avgC != null).length < 2) return [];
  const times: number[] = [];
  if (options.minutes?.length) {
    for (const m of options.minutes) times.push(startMs + m * MINUTE_MS);
  } else {
    for (let ms = startMs; ms < endMs; ms += MINUTE_MS) times.push(ms);
    times.push(endMs);
  }
  return packTemperatures(readings, times, toDisplay).map((t, i) => ({
    minutes: (times[i]! - startMs) / MINUTE_MS,
    avg: t.avg,
    min: t.min,
    max: t.max,
    band: t.min != null && t.max != null ? [t.min, t.max] : null,
  }));
}

/** The chart's series: the band (unlisted), the average line, and max and min for the tooltip. */
export function packTempChartSeries(u: UnitFormatter): TrendSeries[] {
  const reading = { color: 'var(--series-4)', unit: u.temperatureUnit, digits: 1 };
  return [
    {
      key: 'band',
      label: 'Coldest to hottest cell',
      ...reading,
      band: true,
      interpolation: 'linear',
      quiet: true,
    },
    { key: 'max', label: 'Max cell temperature', ...reading, tooltipOnly: true },
    {
      key: 'avg',
      label: 'Average pack temperature',
      ...reading,
      mark: 'line',
      interpolation: 'linear',
      connectNulls: false,
    },
    { key: 'min', label: 'Min cell temperature', ...reading, tooltipOnly: true },
  ];
}

/** A reading in the unit shown, to a tenth: "68.4 °F", or "—" where nothing was recorded. */
export const packTempText = (u: UnitFormatter, c: number | null) =>
  c == null ? '—' : u.formatTemperature(c, 1);

/** A signed change in the unit shown: "+5.4 °F", "−1.5 °C". Scaled, not converted (3 °C of change is 5.4 °F). */
export function packTempChangeText(u: UnitFormatter, c: number | null): string {
  if (c == null) return '—';
  const shown = c * (u.units.temperature === 'F' ? 9 / 5 : 1);
  if (Math.abs(shown) < 0.05) return `0.0 ${u.temperatureUnit}`;
  return `${shown < 0 ? '−' : '+'}${fmt(Math.abs(shown), 1)} ${u.temperatureUnit}`;
}
