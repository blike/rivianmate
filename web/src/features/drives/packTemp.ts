import type { TrendSeries } from '../../components/TrendChart';
import {
  PACK_READING_FRESH_MS,
  type PackReading,
  packTemperatures,
} from '../../lib/packTemperature';
import { fmt } from '../../lib/state';
import type { UnitFormatter } from '../../lib/units';

const MINUTE_MS = 60_000;

export interface PackTempFigures {
  startC: number | null;
  endC: number | null;
  changeC: number | null;
  /** When the reading standing for each end was taken; null where it's unknown. */
  startAt: number | null;
  endAt: number | null;
}

/** The reading nearest a drive's end that is close enough to stand for it. */
function readingNear(readings: readonly PackReading[], endMs: number): PackReading | null {
  let best: PackReading | null = null;
  for (const r of readings) {
    if (Math.abs(r.at - endMs) > PACK_READING_FRESH_MS) continue;
    if (best == null || Math.abs(r.at - endMs) < Math.abs(best.at - endMs)) best = r;
  }
  return best;
}

/**
 * The pack's temperature at each end of a drive and how far it moved between
 * them. Each end takes the nearest reading within PACK_READING_FRESH_MS; an end
 * nothing was recorded near — the app down, or the vehicle asleep — is left
 * unknown rather than passed off as the other end's reading, and the change
 * needs both ends to be known.
 *
 * A drive under way is different: its latest reading is the pack as it is now,
 * however long it has held, so it stands for the end of the drive so far.
 */
export function packTempFigures(
  readings: readonly PackReading[],
  drive: { startMs: number; endMs: number; live?: boolean },
): PackTempFigures {
  const known = readings.filter((r) => r.avgC != null);
  const start = readingNear(known, drive.startMs);
  const end = drive.live ? (known.at(-1) ?? null) : readingNear(known, drive.endMs);
  // One reading can be near both ends of a short drive, but it can't show a change.
  const changeC = start && end && start.at !== end.at ? end.avgC! - start.avgC! : null;
  return {
    startC: start?.avgC ?? null,
    endC: end?.avgC ?? null,
    changeC,
    startAt: start?.at ?? null,
    endAt: end?.at ?? null,
  };
}

/** A row of the pack temperature chart: the average line, and the band around it. */
export type PackTempRow = {
  minutes: number;
  /** The mean of the cells: the line. */
  avg: number | null;
  /** The coldest cell: one edge of the band, and a figure the tooltip names. */
  min: number | null;
  /** The hottest cell: the other edge, and a figure the tooltip names. */
  max: number | null;
  /** The coldest and hottest cell as the band draws them, as one pair. */
  band: [number, number] | null;
};

/**
 * The chart's rows over the drive: the average line and the band its cells sit
 * in, in the unit shown. They run a minute at a time from the drive's start to
 * its end, so this chart's axis lines up with the speed and elevation above it,
 * and each row takes the reading in effect then. The series already carries the
 * break the history route put in where the vehicle went quiet, so a row here is
 * empty only where nothing was known: the line and the band stop there rather
 * than spanning it. One reading is a figure, not a trend, so a drive with fewer
 * than two has no rows at all.
 */
export function packTempSeries(
  readings: readonly PackReading[],
  options: {
    startMs: number;
    endMs: number;
    /** °C as the unit shown. */
    toDisplay: (celsius: number | null | undefined) => number | null;
  },
): PackTempRow[] {
  const { startMs, endMs, toDisplay } = options;
  if (endMs <= startMs || readings.filter((r) => r.avgC != null).length < 2) return [];
  const times: number[] = [];
  for (let ms = startMs; ms < endMs; ms += MINUTE_MS) times.push(ms);
  times.push(endMs);
  return packTemperatures(readings, times, toDisplay).map((t, i) => ({
    minutes: (times[i]! - startMs) / MINUTE_MS,
    avg: t.avg,
    min: t.min,
    max: t.max,
    band: t.min != null && t.max != null ? [t.min, t.max] : null,
  }));
}

/**
 * The series the drive's chart draws: the band the cells sit in, and the three
 * readings the tooltip names — the hottest cell, the pack's average, the coldest
 * cell. The band is the picture rather than a reading of its own, so it is drawn
 * unlisted and the tooltip names its edges and its middle instead of the range.
 */
export function packTempChartSeries(u: UnitFormatter): TrendSeries[] {
  const digits = packTempDigits(u);
  const reading = { color: 'var(--series-4)', unit: u.temperatureUnit, digits };
  return [
    {
      key: 'band',
      label: 'Coldest to hottest cell',
      ...reading,
      band: true,
      // Straight between readings, and broken wherever the series has nothing to
      // draw: the vehicle went quiet there.
      interpolation: 'linear',
      quiet: true,
    },
    { key: 'max', label: 'Max cell temperature', ...reading, tooltipOnly: true },
    {
      key: 'avg',
      label: 'Average pack temperature',
      ...reading,
      mark: 'line',
      // Straight between readings, and never across the breaks the series
      // carries: the line stops and picks up where data resumes.
      interpolation: 'linear',
      connectNulls: false,
    },
    { key: 'min', label: 'Min cell temperature', ...reading, tooltipOnly: true },
  ];
}

/** A whole degree Fahrenheit is half a degree Celsius, so Celsius gets a decimal. */
export const packTempDigits = (u: UnitFormatter) => (u.units.temperature === 'F' ? 0 : 1);

/** A reading in the unit shown: "68 °F", or "—" where nothing was recorded. */
export const packTempText = (u: UnitFormatter, c: number | null) =>
  c == null ? '—' : u.formatTemperature(c, packTempDigits(u));

/**
 * A movement in the unit shown, signed: "+5 °F", "−2 °C". A difference scales
 * rather than shifts — three degrees Celsius is 5.4 Fahrenheit, not 37.4 — and
 * one smaller than the digits show reads as no change, not as a signed zero.
 */
export function packTempChangeText(u: UnitFormatter, c: number | null): string {
  if (c == null) return '—';
  const shown = c * (u.units.temperature === 'F' ? 9 / 5 : 1);
  const digits = packTempDigits(u);
  if (Math.abs(shown) < 0.5 * 10 ** -digits) return `${fmt(0, digits)} ${u.temperatureUnit}`;
  return `${shown < 0 ? '−' : '+'}${fmt(Math.abs(shown), digits)} ${u.temperatureUnit}`;
}
