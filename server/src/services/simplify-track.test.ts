import { describe, expect, it } from 'vitest';
import { simplifyTrack, thinTrack } from './simplify-track.js';

// About 11 m per 0.0001° of latitude.
const p = (lat: number, lon: number) => ({ lat, lon });

describe('simplifyTrack', () => {
  it('collapses a straight stretch to its ends', () => {
    const line = Array.from({ length: 50 }, (_, i) => p(47 + i * 0.0001, -122));
    expect(simplifyTrack(line, 5)).toEqual([0, 49]);
  });

  it('keeps a corner', () => {
    const corner = [p(47, -122), p(47.001, -122), p(47.002, -122), p(47.002, -121.998)];
    expect(simplifyTrack(corner, 5)).toEqual([0, 2, 3]);
  });

  it('keeps short tracks whole', () => {
    expect(simplifyTrack([p(47, -122), p(47.1, -122)], 5)).toEqual([0, 1]);
    expect(simplifyTrack([], 5)).toEqual([]);
  });
});

describe('thinTrack', () => {
  const at = (lat: number, drive: number | null) => ({ ...p(lat, -122), drive });
  const driveOf = (r: { drive: number | null }) => r.drive;

  it('simplifies each drive on its own and keeps parked points', () => {
    const rows = [
      at(47, null),
      ...Array.from({ length: 10 }, (_, i) => at(47 + i * 0.0001, 1)),
      at(47.001, null),
      ...Array.from({ length: 10 }, (_, i) => at(47.001 + i * 0.0001, 2)),
    ];
    expect(thinTrack(rows, driveOf, 5).map((r) => [r.lat, r.drive])).toEqual([
      [47, null],
      [47, 1],
      [47.0009, 1],
      [47.001, null],
      [47.001, 2],
      [47.0019, 2],
    ]);
  });

  it('thins evenly past the limit, keeping both ends', () => {
    const parked = Array.from({ length: 100 }, (_, i) => at(47 + i, null));
    const kept = thinTrack(parked, driveOf, 5, 10);
    expect(kept.length).toBeLessThanOrEqual(11);
    expect(kept[0]).toBe(parked[0]);
    expect(kept.at(-1)).toBe(parked[99]);
  });
});
