import { describe, expect, it } from 'vitest';
import { isAllTime, prefetchRanges, RANGES, rangeOf, refreshOf } from './options';

describe('periods', () => {
  it('ends the list with all time, the only period of no fixed length', () => {
    expect(RANGES.at(-1)!.label).toBe('all');
    expect(isAllTime(RANGES.at(-1)!)).toBe(true);
    expect(RANGES.filter(isAllTime)).toHaveLength(1);
  });

  it('leaves all time out of what loads ahead, but still loads its neighbour', () => {
    // 12 months' neighbour is all time, whose window is the whole history.
    expect(prefetchRanges(rangeOf('12m')).map((r) => r.label)).toEqual(['6m']);
    expect(prefetchRanges(rangeOf('7d')).map((r) => r.label)).toEqual(['24h', '14d']);
    // All time still loads the bounded period beside it.
    expect(prefetchRanges(rangeOf('all')).map((r) => r.label)).toEqual(['12m']);
  });

  it('reads all time once instead of polling it', () => {
    expect(refreshOf(rangeOf('all'))).toMatchObject({ refetchInterval: false });
    // Fixed-length periods keep their own polling.
    expect(refreshOf(rangeOf('12m'))).toEqual({});
  });
});
