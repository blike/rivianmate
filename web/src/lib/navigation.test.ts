import { describe, expect, it } from 'vitest';
import { type Navigation, nextStop, routeProgress, stopMarks } from './navigation';

describe('routeProgress', () => {
  it('is the share driven of driven plus what navigation has left', () => {
    expect(routeProgress(2.5, 7.5)).toBe(0.25);
    expect(routeProgress(0, 4)).toBe(0);
    expect(routeProgress(3, 0)).toBe(1);
  });

  it("is unknown without both distances, or before there's any route", () => {
    expect(routeProgress(null, 4)).toBeNull();
    expect(routeProgress(2, null)).toBeNull();
    expect(routeProgress(0, 0)).toBeNull();
  });
});

const stop = (name: string, remainingKm: number | null) => ({
  name,
  lat: 0,
  lon: 0,
  remainingKm,
  remainingS: null,
  etaAt: null,
});
const nav = (stops: Navigation['stops'], remainingKm: number | null): Navigation => ({
  destination: { name: 'Home', lat: 0, lon: 0 },
  totalDistanceKm: null,
  totalDurationS: null,
  arrivalSoc: null,
  arrivalRangeKm: null,
  etaAt: null,
  route: null,
  remainingKm,
  remainingS: null,
  stops,
  at: '2026-10-28T21:15:00Z',
});

describe('nextStop', () => {
  it('is the first stop ahead, with how many follow it', () => {
    expect(nextStop(nav([stop("Menchie's", 3), stop('Home', 18)], 18))).toEqual({
      name: "Menchie's",
      after: 1,
    });
    expect(nextStop(nav([], 18))).toEqual({ name: 'Home', after: 0 });
  });
});

describe('stopMarks', () => {
  it('numbers every stop from the next, the destination at the end of the drive', () => {
    expect(stopMarks(4, nav([stop("Menchie's", 4), stop('Home', 16)], 16))).toEqual([
      { at: 0.4, name: "Menchie's", number: 1 },
      { at: 1, name: 'Home', number: 2 },
    ]);
  });

  it('marks nothing for a single destination, nor a stop it has no distance for', () => {
    expect(stopMarks(4, nav([stop('Home', 16)], 16))).toEqual([]);
    expect(stopMarks(4, nav([stop("Menchie's", null), stop('Home', 16)], 16))).toEqual([
      { at: 1, name: 'Home', number: 2 },
    ]);
    expect(stopMarks(null, nav([stop("Menchie's", 4), stop('Home', 16)], 16))).toEqual([]);
  });
});
