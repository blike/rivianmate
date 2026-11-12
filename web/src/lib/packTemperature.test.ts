import type { HistoryPoint } from '@server/api-types';
import { describe, expect, it } from 'vitest';
import {
  PACK_TEMPERATURE_HOLD_MS,
  packReadings,
  packTemperatures,
  type PackReading,
} from './packTemperature';

const START = Date.parse('2026-11-11T20:00:00Z');
const minute = (n: number) => START + n * 60_000;
/** A row of the `temp` series, as the history route returns one. */
const row = (at: number, avg: number, min: number | null, max: number | null): HistoryPoint => ({
  bucket: new Date(at).toISOString(),
  avg,
  min,
  max,
});
const fahrenheit = (c: number | null | undefined) => (c == null ? null : (c * 9) / 5 + 32);
const celsius = (c: number | null | undefined) => c ?? null;

describe('packReadings', () => {
  it('reads history rows in time order, skipping rows with nothing in them', () => {
    const rows = packReadings([
      row(minute(20), 21, 20, 22),
      row(minute(0), 20, 19, 21),
      { bucket: new Date(minute(10)).toISOString(), avg: null, min: null, max: null },
    ]);
    expect(rows.map((r) => r.avgC)).toEqual([20, 21]);
    expect(rows[0]).toEqual({ at: START, avgC: 20, minC: 19, maxC: 21 });
  });
});

describe('packTemperatures', () => {
  const readings: PackReading[] = [
    { at: minute(0), avgC: 24.5, minC: 22, maxC: 27 },
    { at: minute(40), avgC: 38, minC: 35, maxC: 41 },
  ];

  it('draws the mean and the band around it in the unit asked for', () => {
    expect(packTemperatures(readings.slice(0, 1), [minute(0), minute(5)], fahrenheit)).toEqual([
      { avg: 76.1, min: 71.6, max: 80.6 },
      { avg: 76.1, min: 71.6, max: 80.6 },
    ]);
  });

  it('leaves the values in celsius when that is the unit', () => {
    expect(packTemperatures(readings.slice(0, 1), [minute(1)], celsius)).toEqual([
      { avg: 24.5, min: 22, max: 27 },
    ]);
  });

  it('breaks the line and the band where the vehicle stopped reporting', () => {
    const hold = PACK_TEMPERATURE_HOLD_MS / 60_000;

    expect(
      packTemperatures(readings, [minute(0), minute(hold), minute(hold + 1), minute(39)], celsius),
    ).toEqual([
      { avg: 24.5, min: 22, max: 27 },
      // The last reading still stands at the edge of the hold, and no further.
      { avg: 24.5, min: 22, max: 27 },
      { avg: null, min: null, max: null },
      { avg: null, min: null, max: null },
    ]);
    // The next reading picks the line up again.
    expect(packTemperatures(readings, [minute(40)], celsius)).toEqual([
      { avg: 38, min: 35, max: 41 },
    ]);
  });

  it('leaves a field the vehicle never reported empty, drawing the line without its band', () => {
    const noCells = [{ at: minute(0), avgC: 20, minC: null, maxC: null }];

    expect(packTemperatures(noCells, [minute(0)], celsius)).toEqual([
      { avg: 20, min: null, max: null },
    ]);
  });

  it('draws nothing before the first reading, or without any', () => {
    expect(packTemperatures(readings, [minute(-1)], celsius)).toEqual([
      { avg: null, min: null, max: null },
    ]);
    expect(packTemperatures([], [minute(0), minute(1)], fahrenheit)).toEqual([
      { avg: null, min: null, max: null },
      { avg: null, min: null, max: null },
    ]);
  });
});
