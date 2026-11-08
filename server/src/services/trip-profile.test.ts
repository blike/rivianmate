import { describe, expect, it } from 'vitest';
import { tripProfiles } from './trip-profile.js';

const road = (driveId: number, altitudes: (number | null)[]) =>
  altitudes.map((altitude, i) => ({ driveId, altitude, lat: 37 + i * 0.01, lon: -119 }));

describe('tripProfiles', () => {
  it('measures distance along each drive and leaves out readings with no altitude', () => {
    const profile = tripProfiles(road(1, [100, null, 100, 100]))!.get(1)!;
    expect(profile).toHaveLength(3);
    expect(profile[0]!.km).toBe(0);
    expect(profile[2]!.km).toBeGreaterThan(3);
  });

  it('keeps a summit when thinning a long road', () => {
    const altitudes = Array.from({ length: 2000 }, (_, i) => (i > 990 && i < 1010 ? 3000 : 500));
    const profile = tripProfiles(road(1, altitudes), 100).get(1)!;
    expect(profile.length).toBeLessThanOrEqual(102);
    expect(Math.max(...profile.map((p) => p.altitudeM))).toBe(3000);
  });

  it('ignores a single spike in the GPS altitude', () => {
    const profile = tripProfiles(road(1, [500, 500, 9000, 500, 500]), 1000).get(1)!;
    expect(Math.max(...profile.map((p) => p.altitudeM))).toBe(500);
  });

  it('is empty without altitude, and keeps drives apart', () => {
    expect(tripProfiles(road(1, [null, null])).size).toBe(0);
    const both = tripProfiles([...road(1, [100, 110]), ...road(2, [200, 210])]);
    expect([...both.keys()]).toEqual([1, 2]);
    expect(both.get(2)![0]!.km).toBe(0);
  });
});
