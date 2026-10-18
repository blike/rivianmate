import { describe, expect, it } from 'vitest';
import { simplifyTrack } from './simplify-track.js';

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
