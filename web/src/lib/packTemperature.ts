import type { HistoryPoint } from '@server/api-types';

/**
 * How long a reading stands for the time after it: past this the line and the
 * band break rather than drawn across a silence the vehicle never reported.
 *
 * A pack temperature is recorded only while the vehicle is awake, and only once
 * it moves past its deadband, so readings arrive every ~12 s of driving and
 * ~25 s of charging, and can pause for minutes over a pack holding still. A
 * quarter of an hour bridges that pause — 36 times the slower cadence — and is
 * far short of a car that has gone to sleep, where half an hour would draw the
 * band through the first minutes of the silence. The same quarter of an hour
 * decides whether a reading is near enough to a drive's end to stand for it, so
 * the figures and the chart agree about what counts as current.
 */
export const PACK_TEMPERATURE_HOLD_MS = 15 * 60_000;

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
 * The `temp` history series as readings, in time order. A row with nothing in
 * it at all is left out.
 */
export function packReadings(points: readonly HistoryPoint[]): PackReading[] {
  return points
    .map((p) => ({ at: Date.parse(p.bucket), avgC: p.avg, minC: p.min, maxC: p.max }))
    .filter((r) => Number.isFinite(r.at) && (r.avgC != null || r.minC != null || r.maxC != null))
    .sort((a, b) => a.at - b.at);
}

/** The reading at or before `ms`, when it's recent enough to stand for it. */
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
  if (found < 0) return null;
  const reading = readings[found]!;
  return ms - reading.at <= PACK_TEMPERATURE_HOLD_MS ? reading : null;
}

/**
 * The pack's temperature at each of `times` (ms), from the readings recorded
 * around them: the mean for the line, the coldest and hottest cells for the
 * band. A time with no reading recent enough gets nulls, so a chart breaks the
 * band and the line where the vehicle stopped reporting rather than spanning
 * the silence. This is the one place a pack temperature becomes a chart value,
 * shared by the charge and drive charts.
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
