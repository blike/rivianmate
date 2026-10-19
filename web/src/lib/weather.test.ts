import { describe, expect, it } from 'vitest';
import { compass, isDaytime, weatherKind, weatherLabel } from './weather';

describe('weatherLabel', () => {
  it('names WMO codes', () => {
    expect(weatherLabel(0)).toBe('Clear');
    expect(weatherLabel(2)).toBe('Partly cloudy');
    expect(weatherLabel(45)).toBe('Fog');
    expect(weatherLabel(63)).toBe('Rain');
    expect(weatherLabel(96)).toBe('Thunderstorms with hail');
  });
});

describe('weatherKind', () => {
  it('groups codes by what to draw', () => {
    expect([0, 1, 2, 3, 45, 53, 63, 73, 85, 81, 95].map(weatherKind)).toEqual([
      'clear',
      'clear',
      'partly',
      'cloudy',
      'fog',
      'rain',
      'rain',
      'snow',
      'snow',
      'rain',
      'storm',
    ]);
  });
});

describe('isDaytime', () => {
  // San Diego; sunset there on Oct 16, 2026 is about 01:15 UTC the next day.
  const sd = (iso: string) => isDaytime(32.88, -117.22, Date.parse(iso));
  it('follows the sun', () => {
    expect(sd('2026-10-16T22:23:00Z')).toBe(true);
    expect(sd('2026-10-17T01:00:00Z')).toBe(true);
    expect(sd('2026-10-17T01:35:00Z')).toBe(false);
    expect(sd('2026-10-17T09:00:00Z')).toBe(false);
  });
});

describe('compass', () => {
  it('rounds to the nearest of eight points', () => {
    expect(compass(0)).toBe('N');
    expect(compass(350)).toBe('N');
    expect(compass(225)).toBe('SW');
    expect(compass(-90)).toBe('W');
  });
});
