import { describe, expect, it } from 'vitest';
import { socEnergyKwh } from './charging.js';

describe('socEnergyKwh', () => {
  it("is the battery gained as a share of the pack's capacity", () => {
    expect(socEnergyKwh({ startSoc: 45, endSoc: 70 }, 131)).toBeCloseTo(32.75);
  });

  it('is unknown without both levels and a capacity, or without a gain', () => {
    expect(socEnergyKwh({ startSoc: null, endSoc: 70 }, 131)).toBeNull();
    expect(socEnergyKwh({ startSoc: 45, endSoc: 70 }, null)).toBeNull();
    expect(socEnergyKwh({ startSoc: 70, endSoc: 70 }, 131)).toBeNull();
  });
});
