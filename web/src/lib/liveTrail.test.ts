import type { LocationPointDto } from '@server/api-types';
import { describe, expect, it } from 'vitest';
import { liveTrail } from './liveTrail';

const point = (ts: string, lat: number, lon: number): LocationPointDto => ({
  ts,
  lat,
  lon,
  speedKmh: null,
  bearing: null,
  altitude: null,
});

describe('liveTrail', () => {
  const stored = [
    point('2026-10-28T21:40:00Z', 33.1, -117.1),
    point('2026-10-28T21:40:05Z', 33.11, -117.1),
  ];

  it('follows every live fix past the stored points, not just the latest', () => {
    expect(
      liveTrail(stored, [
        { ts: '2026-10-28T21:40:10Z', lat: 33.12, lon: -117.11 },
        { ts: '2026-10-28T21:40:15Z', lat: 33.13, lon: -117.13 },
      ]),
    ).toEqual([
      [33.1, -117.1],
      [33.11, -117.1],
      [33.12, -117.11],
      [33.13, -117.13],
    ]);
  });

  it('leaves out fixes the stored points already have, in any timestamp format', () => {
    expect(
      liveTrail(stored, [
        { ts: '2026-10-28T21:40:05.000Z', lat: 33.11, lon: -117.1 },
        { ts: '2026-10-28T21:40:10Z', lat: 33.12, lon: -117.11 },
      ]),
    ).toEqual([
      [33.1, -117.1],
      [33.11, -117.1],
      [33.12, -117.11],
    ]);
  });

  it('is the live fixes alone before any point is stored', () => {
    expect(liveTrail([], [{ ts: '2026-10-28T21:40:10Z', lat: 33.12, lon: -117.11 }])).toEqual([
      [33.12, -117.11],
    ]);
  });
});
