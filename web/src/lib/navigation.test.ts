import { describe, expect, it } from 'vitest';
import { routeProgress } from './navigation';

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
