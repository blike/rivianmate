import type { HistoryPoint } from '@server/api-types';

/**
 * How close a reading has to be to a drive's end to stand for it: one heartbeat
 * interval, the longest the app expects the vehicle to go without hearing from
 * it. Only a figure's end is judged by time — the chart is not, because the
 * history route puts the break where the vehicle went quiet, so a row on it is
 * a reading that held.
 */
export const PACK_READING_FRESH_MS = 15 * 60_000;

/** A pack temperature reading: the average, and the coldest and hottest cell around it. */
export interface PackReading {
  /** When the vehicle reported it. */
  at: number;
  avgC: number | null;
  minC: number | null;
  maxC: number | null;
}

/** The pack's temperature at one point on a chart, in the unit asked for. */
export interface PackTemperature {
  /** The mean of the cells. */
  avg: number | null;
  /** The coldest cell; with `max`, the band around the mean. */
  min: number | null;
  max: number | null;
}

/**
 * The `temp` history series as readings, in time order. A row with nothing in it
 * is a silence the route put there because the vehicle stopped being heard: it
 * stays, so the reading before it stops there and the line breaks, instead of
 * being dropped and the silence drawn over.
 */
export function packReadings(points: readonly HistoryPoint[]): PackReading[] {
  return points
    .map((p) => ({ at: Date.parse(p.bucket), avgC: p.avg, minC: p.min, maxC: p.max }))
    .filter((r) => Number.isFinite(r.at))
    .sort((a, b) => a.at - b.at);
}

/** The reading in effect at `ms`: the last one at or before it, empty where nothing had been read. */
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

/**
 * The pack's temperature at each of `times` (ms), from the readings recorded
 * around them: the mean for the line, the coldest and hottest cells for the
 * band. Each time takes the reading in effect then and no other; a time with no
 * reading before it gets nulls, so a chart draws nothing before the first one.
 * A row of nulls in the series is the vehicle going quiet, and it breaks the
 * band and the line there rather than letting them span the silence. This is the
 * one place a pack temperature becomes a chart value, drawn on the drive page
 * and the charge page alike.
 */
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
