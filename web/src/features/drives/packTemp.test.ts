import { describe, expect, it } from 'vitest';
import { PACK_READING_FRESH_MS, type PackReading } from '../../lib/packTemperature';
import { unitFormatter } from '../../lib/units';
import {
  packTempChangeText,
  packTempChartSeries,
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
/** The route's mark that the vehicle stopped being heard `minutes` into the drive. */
const silence = (minutes: number): PackReading => ({
  at: START + minutes * MIN,
  avgC: null,
  minC: null,
  maxC: null,
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
    const inside = figures([reading(PACK_READING_FRESH_MS / MIN, 20), reading(45, 22)], 60);
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
    expect(rows[0]).toEqual({ minutes: 0, avg: 20, min: 19, max: 21, band: [19, 21] });
    expect(rows[5]).toEqual({ minutes: 5, avg: 20, min: 19, max: 21, band: [19, 21] });
    expect(rows[10]).toEqual({ minutes: 10, avg: 21, min: 20, max: 22, band: [20, 22] });
  });

  it('converts the line and both ends of the band to the unit shown', () => {
    const rows = series([reading(0, 20), reading(10, 21)], 10, FAHRENHEIT);
    expect(rows[0]).toEqual({ minutes: 0, avg: 68, min: 66.2, max: 69.8, band: [66.2, 69.8] });
    expect(rows[10]!.band).toEqual([68, 71.6]);
  });

  it('leaves the band out where a reading has no cells around it', () => {
    const rows = series([{ ...reading(0, 20), minC: null, maxC: null }, reading(10, 21)], 10);
    expect(rows[0]!.band).toBeNull();
    expect(rows[0]!.avg).toBe(20);
  });

  it('breaks the line and the band where the series says the vehicle went quiet', () => {
    const rows = series([reading(0, 20), silence(20), reading(40, 23)], 40);
    const at = (minute: number) => rows.find((r) => r.minutes === minute)!;

    // The reading before the mark stands up to it, and no further.
    expect(at(19).avg).toBe(20);
    expect(at(20)).toEqual({ minutes: 20, avg: null, min: null, max: null, band: null });
    expect(at(39)).toEqual({ minutes: 39, avg: null, min: null, max: null, band: null });
    // The next reading picks both up again.
    expect(at(40)).toEqual({ minutes: 40, avg: 23, min: 22, max: 24, band: [22, 24] });
  });

  it('draws a reading through to the next one, however long the stretch between them', () => {
    const rows = series([reading(0, 20), reading(40, 20.5)], 40);

    expect(rows.every((r) => r.avg != null)).toBe(true);
    expect(rows.at(-1)!.avg).toBe(20.5);
  });

  it('spans the drive at both ends, so its axis matches the chart above', () => {
    // Read in the middle of the drive only: the ends have nothing to draw, and
    // the rows still run from the start of the drive to its end.
    const rows = series([reading(5, 20), reading(15, 22), silence(30)], 60);
    expect(rows.map((r) => r.minutes)).toEqual(Array.from({ length: 61 }, (_, i) => i));
    expect(rows[0]).toEqual({ minutes: 0, avg: null, min: null, max: null, band: null });
    expect(rows.at(-1)).toEqual({ minutes: 60, avg: null, min: null, max: null, band: null });
  });

  it('has no rows for a drive with fewer than two readings', () => {
    expect(series([], 60)).toEqual([]);
    expect(series([reading(30, 22)], 60)).toEqual([]);
  });
});

describe('packTempChartSeries', () => {
  const series = packTempChartSeries(FAHRENHEIT);

  it('keeps the band, drawn rather than listed as a range', () => {
    const band = series.find((s) => s.band)!;

    expect(band.key).toBe('band');
    expect(band.quiet).toBe(true);
    expect(band.interpolation).toBe('linear');
  });

  it('names the hottest cell, the pack’s average and the coldest, in that order', () => {
    expect(series.map((s) => s.label)).toEqual([
      'Coldest to hottest cell',
      'Max cell temperature',
      'Average pack temperature',
      'Min cell temperature',
    ]);
    // The average is the line; the two ends are figures the tooltip names only.
    expect(series.filter((s) => s.mark === 'line').map((s) => s.key)).toEqual(['avg']);
    expect(series.filter((s) => s.tooltipOnly).map((s) => s.key)).toEqual(['max', 'min']);
    expect(series.filter((s) => s.tooltipOnly).every((s) => s.unit === '°F')).toBe(true);
    expect(series.filter((s) => s.tooltipOnly).every((s) => s.digits === 0)).toBe(true);
  });

  it('says the same in celsius, with a decimal to the degree', () => {
    const celsius = packTempChartSeries(CELSIUS);

    expect(celsius.find((s) => s.key === 'max')!.unit).toBe('°C');
    expect(celsius.find((s) => s.key === 'max')!.digits).toBe(1);
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
