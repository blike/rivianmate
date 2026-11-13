import type { HistoryPoint } from '@server/api-types';
import { describe, expect, it } from 'vitest';
import { packReadings, packTemperatures, type PackReading } from './packTemperature';

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
  it('reads history rows in time order, keeping the empty ones as the marks of a silence', () => {
    const rows = packReadings([
      row(minute(20), 21, 20, 22),
      row(minute(0), 20, 19, 21),
      { bucket: new Date(minute(10)).toISOString(), avg: null, min: null, max: null },
    ]);
    expect(rows.map((r) => r.avgC)).toEqual([20, null, 21]);
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

  it('breaks the line and the band at an empty row, and picks up after it', () => {
    const silence = packReadings([
      row(minute(0), 20, 19, 21),
      // The route's mark: the vehicle stopped being heard a quarter of an hour
      // after the last heartbeat, and this is where the values stop.
      { bucket: new Date(minute(15)).toISOString(), avg: null, min: null, max: null },
      row(minute(40), 26, 25, 27),
    ]);

    expect(
      packTemperatures(
        silence,
        [minute(0), minute(14), minute(15), minute(30), minute(40)],
        celsius,
      ),
    ).toEqual([
      { avg: 20, min: 19, max: 21 },
      { avg: 20, min: 19, max: 21 },
      { avg: null, min: null, max: null },
      { avg: null, min: null, max: null },
      { avg: 26, min: 25, max: 27 },
    ]);
  });

  it('draws a steady charge unbroken when the series carries a row per heartbeat', () => {
    // A charge at rest: the pack holds, so the rows are the heartbeats — a
    // quarter of an hour apart, and here and there a sync the app missed. None
    // of that is a silence: the vehicle was heard throughout, so nothing breaks.
    const steady: PackReading[] = [0, 15, 35, 50, 65].map((m) => ({
      at: minute(m),
      avgC: 21.2,
      minC: 20,
      maxC: 22.4,
    }));
    const times = Array.from({ length: 66 }, (_, m) => minute(m));

    expect(packTemperatures(steady, times, celsius)).toEqual(
      times.map(() => ({ avg: 21.2, min: 20, max: 22.4 })),
    );
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
