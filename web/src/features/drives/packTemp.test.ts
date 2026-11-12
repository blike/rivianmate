import { describe, expect, it } from 'vitest';
import { PACK_TEMPERATURE_HOLD_MS, type PackReading } from '../../lib/packTemperature';
import { unitFormatter } from '../../lib/units';
import {
  packTempChangeText,
  packTempDigits,
  packTempFigures,
  packTempSeries,
  packTempText,
} from './packTemp';

const CELSIUS = unitFormatter({ distance: 'km', temperature: 'C' });
const FAHRENHEIT = unitFormatter({ distance: 'mi', temperature: 'F' });

const START = Date.parse('2026-10-12T14:00:00Z');
const MIN = 60_000;
/** A reading `minutes` into the drive, with the cells a degree either side of its average. */
const reading = (minutes: number, avgC: number, minC = avgC - 1, maxC = avgC + 1): PackReading => ({
  at: START + minutes * MIN,
  avgC,
  minC,
  maxC,
});

/** A drive of `minutes`, with the readings given. */
const figures = (readings: PackReading[], minutes: number, live = false) =>
  packTempFigures(readings, { startMs: START, endMs: START + minutes * MIN, live });

const series = (readings: PackReading[], minutes: number, units = CELSIUS) =>
  packTempSeries(readings, {
    startMs: START,
    endMs: START + minutes * MIN,
    toDisplay: units.temperature,
  });

describe('packTempFigures', () => {
  it('takes the reading at each end and the change between them', () => {
    const found = figures([reading(0, 20), reading(20, 21), reading(40, 23)], 40);
    expect(found.startC).toBe(20);
    expect(found.endC).toBe(23);
    expect(found.changeC).toBe(3);
    expect(found.startAt).toBe(START);
    expect(found.endAt).toBe(START + 40 * MIN);
  });

  it('reports a cooling pack as a fall', () => {
    expect(figures([reading(0, 30), reading(30, 27)], 30).changeC).toBe(-3);
  });

  it('takes the reading nearest an end rather than the first one recorded', () => {
    // Nothing at the drive's start, and two readings close to its end.
    const found = figures([reading(50, 20), reading(58, 22)], 60);
    expect(found.startC).toBeNull();
    expect(found.endC).toBe(22);
    expect(found.changeC).toBeNull();
  });

  it('shows the end it has and leaves the other unknown when readings stop early', () => {
    const found = figures([reading(0, 20), reading(8, 21)], 60);
    expect(found.startC).toBe(20);
    expect(found.endC).toBeNull();
    expect(found.changeC).toBeNull();
    expect(found.startAt).toBe(START);
    expect(found.endAt).toBeNull();
  });

  it('shows the start it has and leaves the other unknown when readings begin late', () => {
    const found = figures([reading(52, 25), reading(60, 26)], 60);
    expect(found.startC).toBeNull();
    expect(found.endC).toBe(26);
    expect(found.changeC).toBeNull();
    expect(found.startAt).toBeNull();
  });

  it('keeps a reading within a quarter of an hour of an end', () => {
    const inside = figures([reading(PACK_TEMPERATURE_HOLD_MS / MIN, 20), reading(45, 22)], 60);
    expect(inside.startC).toBe(20);
    expect(inside.endC).toBe(22);

    // Further out than that, the last reading says nothing about the end.
    expect(figures([reading(0, 20), reading(40, 23)], 60).endC).toBeNull();
  });

  it('shows no change when the one reading is close enough to both ends', () => {
    const found = figures([reading(3, 22)], 5);
    expect(found.startC).toBe(22);
    expect(found.endC).toBe(22);
    expect(found.changeC).toBeNull();
  });

  it('takes a drive under way’s latest reading as the end, however long it has held', () => {
    const found = figures([reading(0, 20), reading(5, 21)], 40, true);
    expect(found.endC).toBe(21);
    expect(found.changeC).toBe(1);
  });

  it('has nothing to show for a drive with no readings', () => {
    expect(figures([], 60)).toEqual({
      startC: null,
      endC: null,
      changeC: null,
      startAt: null,
      endAt: null,
    });
  });
});

describe('packTempSeries', () => {
  it('draws the average as the line and the cells as the band', () => {
    const rows = series([reading(0, 20), reading(10, 21)], 10);
    expect(rows.map((r) => r.minutes)).toEqual(Array.from({ length: 11 }, (_, i) => i));
    expect(rows[0]).toEqual({ minutes: 0, avg: 20, band: [19, 21] });
    expect(rows[5]).toEqual({ minutes: 5, avg: 20, band: [19, 21] });
    expect(rows[10]).toEqual({ minutes: 10, avg: 21, band: [20, 22] });
  });

  it('converts the line and both ends of the band to the unit shown', () => {
    const rows = series([reading(0, 20), reading(10, 21)], 10, FAHRENHEIT);
    expect(rows[0]).toEqual({ minutes: 0, avg: 68, band: [66.2, 69.8] });
    expect(rows[10]!.band).toEqual([68, 71.6]);
  });

  it('leaves the band out where a reading has no cells around it', () => {
    const rows = series([{ ...reading(0, 20), minC: null, maxC: null }, reading(10, 21)], 10);
    expect(rows[0]!.band).toBeNull();
    expect(rows[0]!.avg).toBe(20);
  });

  it('breaks the line and the band across a silence longer than a reading stands', () => {
    const holdMinutes = PACK_TEMPERATURE_HOLD_MS / MIN;
    const rows = series([reading(0, 20), reading(holdMinutes + 10, 23)], holdMinutes + 10);
    const at = (minute: number) => rows.find((r) => r.minutes === minute)!;

    // The last reading stands for a quarter of an hour, and no further.
    expect(at(0).avg).toBe(20);
    expect(at(holdMinutes).avg).toBe(20);
    expect(at(holdMinutes + 1)).toEqual({ minutes: holdMinutes + 1, avg: null, band: null });
    // The next reading picks both up again.
    expect(at(holdMinutes + 10)).toEqual({ minutes: holdMinutes + 10, avg: 23, band: [22, 24] });
  });

  it('draws a silence shorter than that through, as a reading that still stands', () => {
    const rows = series([reading(0, 20), reading(10, 20.5)], 10);

    expect(rows.every((r) => r.avg != null)).toBe(true);
    expect(rows.at(-1)!.avg).toBe(20.5);
  });

  it('spans the drive at both ends, so its axis matches the chart above', () => {
    const rows = series([reading(5, 20), reading(15, 22)], 60);
    expect(rows.map((r) => r.minutes)).toEqual(Array.from({ length: 61 }, (_, i) => i));
    expect(rows[0]).toEqual({ minutes: 0, avg: null, band: null });
    expect(rows.at(-1)).toEqual({ minutes: 60, avg: null, band: null });
  });

  it('has no rows for a drive with fewer than two readings', () => {
    expect(series([], 60)).toEqual([]);
    expect(series([reading(30, 22)], 60)).toEqual([]);
  });
});

describe('the figures as they read', () => {
  it('gives a reading in the unit shown, to the degree it can be read', () => {
    expect(packTempText(FAHRENHEIT, 20)).toBe('68 °F');
    expect(packTempText(CELSIUS, 20.4)).toBe('20.4 °C');
    expect(packTempText(FAHRENHEIT, null)).toBe('—');
    expect(packTempDigits(FAHRENHEIT)).toBe(0);
    expect(packTempDigits(CELSIUS)).toBe(1);
  });

  it('signs a movement, scaling it rather than shifting it', () => {
    // Three degrees Celsius is 5.4 Fahrenheit: the scale, not 37.4.
    expect(packTempChangeText(FAHRENHEIT, 3)).toBe('+5 °F');
    expect(packTempChangeText(CELSIUS, 3)).toBe('+3.0 °C');
    expect(packTempChangeText(FAHRENHEIT, -2)).toBe('−4 °F');
    expect(packTempChangeText(CELSIUS, -1.5)).toBe('−1.5 °C');
  });

  it('calls a movement below what the digits show no change', () => {
    expect(packTempChangeText(FAHRENHEIT, 0.1)).toBe('0 °F');
    expect(packTempChangeText(CELSIUS, 0.04)).toBe('0.0 °C');
    expect(packTempChangeText(CELSIUS, null)).toBe('—');
  });
});
