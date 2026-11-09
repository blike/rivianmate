import { describe, expect, it } from 'vitest';
import { fitTimeTicks, labelAlign, timeTicks } from './timeAxis';

const local = (day: number, hour: number, minute = 0) =>
  new Date(2026, 9, day, hour, minute).getTime();

describe('timeTicks', () => {
  it('uses hour ticks with times of day for a span under a day, dates at midnight', () => {
    const { ticks, format } = timeTicks(local(1, 4, 40), local(2, 2, 36));
    expect(ticks.length).toBeLessThanOrEqual(8);
    expect(
      ticks.every((t) => new Date(t).getMinutes() === 0 && new Date(t).getHours() % 3 === 0),
    ).toBe(true);
    expect(ticks[0]).toBe(local(1, 6));
    const labels = ticks.map(format);
    expect(new Set(labels).size).toBe(labels.length);
    expect(format(local(2, 0))).toBe(
      new Date(local(2, 0)).toLocaleDateString([], { month: 'short', day: 'numeric' }),
    );
  });

  it('uses one tick per local midnight for a week', () => {
    const { ticks, format } = timeTicks(local(1, 9), local(8, 9));
    expect(ticks).toEqual([2, 3, 4, 5, 6, 7, 8].map((d) => local(d, 0)));
    expect(new Set(ticks.map(format)).size).toBe(7);
  });

  it('spaces ticks out for long ranges', () => {
    const { ticks } = timeTicks(local(1, 0), local(1, 0) + 90 * 86_400_000);
    expect(ticks.length).toBeLessThanOrEqual(8);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    // A year fits too, a tick every two months or so.
    const year = timeTicks(local(1, 0), local(1, 0) + 365 * 86_400_000);
    expect(year.ticks.length).toBeLessThanOrEqual(8);
    expect(year.ticks.length).toBeGreaterThanOrEqual(5);
  });
});

describe('timeTicks past a year', () => {
  const year = (y: number, m = 0, d = 1) => new Date(y, m, d).getTime();

  it('never repeats a label over three years', () => {
    const from = year(2023, 3, 2);
    const to = year(2026, 3, 2);
    const { ticks, format } = timeTicks(from, to, 7);
    const labels = ticks.map(format);
    expect(ticks.length).toBeLessThanOrEqual(7);
    expect(new Set(labels).size).toBe(labels.length);
    // Ticks on the first of a month.
    expect(ticks.every((t) => new Date(t).getDate() === 1)).toBe(true);
  });

  it('labels a January with its year among month ticks', () => {
    const { ticks, format } = timeTicks(year(2025, 1), year(2026, 1), 7);
    const jan = ticks.find((t) => new Date(t).getMonth() === 0)!;
    expect(format(jan)).toBe('2026');
    expect(new Set(ticks.map(format)).size).toBe(ticks.length);
  });

  it('spans of many years tick by year', () => {
    const { ticks, format } = timeTicks(year(2016, 5), year(2026, 5), 7);
    expect(ticks.map(format)).toEqual(['2018', '2020', '2022', '2024', '2026']);
  });

  it('labels 366–427 days without repeats', () => {
    for (let days = 366; days <= 427; days += 7) {
      const from = year(2025, 2, 10);
      const { ticks, format } = timeTicks(from, from + days * 86_400_000, 7);
      const labels = ticks.map(format);
      expect(new Set(labels).size, String(days)).toBe(labels.length);
    }
  });
});

describe('fitTimeTicks', () => {
  const at11px = (label: string) => label.length * 6.5;
  const day = (d: number) => new Date(2026, 9, d).getTime();

  it('drops ticks until the labels clear each other at phone width', () => {
    const from = day(1) + 9 * 3600_000;
    const to = day(8) + 9 * 3600_000;
    const wide = fitTimeTicks(from, to, 7, 1000, at11px);
    expect(wide.ticks).toHaveLength(7);
    const narrow = fitTimeTicks(from, to, 7, 268, at11px);
    expect(narrow.ticks.length).toBeLessThan(7);
    // Every pair clears the gap, as laid out by the strip.
    let end = -Infinity;
    for (const t of narrow.ticks) {
      const f = (t - from) / (to - from);
      const w = at11px(narrow.format(t));
      const align = labelAlign(f);
      const start = align === 'start' ? f * 268 : align === 'end' ? f * 268 - w : f * 268 - w / 2;
      expect(start).toBeGreaterThanOrEqual(end + 8);
      end = start + w;
    }
  });

  it('gives maxTicks while the width is unknown', () => {
    expect(fitTimeTicks(day(1), day(8), 7, 0, at11px)).toEqual(timeTicks(day(1), day(8), 7));
  });
});
