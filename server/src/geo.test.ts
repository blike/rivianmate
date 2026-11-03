import { describe, expect, it } from 'vitest';
import { isPosition } from './geo.js';

describe('isPosition', () => {
  it('drops the 0,0 Rivian sends without a fix, and impossible positions', () => {
    expect(isPosition(0, 0)).toBe(false);
    expect(isPosition(0.00001, -0.00002)).toBe(false);
    expect(isPosition(91, 10)).toBe(false);
    expect(isPosition(10, -181)).toBe(false);
    expect(isPosition(Number.NaN, 10)).toBe(false);
    expect(isPosition(null, 10)).toBe(false);
  });

  it('keeps real places near the equator or the prime meridian', () => {
    expect(isPosition(0, 32.5)).toBe(true); // Lake Victoria
    expect(isPosition(51.48, 0)).toBe(true); // Greenwich
    expect(isPosition(34.0026, -116.0522)).toBe(true);
  });
});
