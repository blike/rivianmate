import { describe, expect, it } from 'vitest';
import { averagePowerKw, sessionEnergy } from './sessionEnergy';

describe('sessionEnergy', () => {
  it('prefers the live reading, then Rivian’s, then the estimate', () => {
    const s = { energyKwh: 20, estimatedEnergyKwh: null };
    expect(sessionEnergy(s, 12)).toEqual({ kwh: 12, estimated: false });
    expect(sessionEnergy(s)).toEqual({ kwh: 20, estimated: false });
    expect(sessionEnergy({ energyKwh: null, estimatedEnergyKwh: 33 })).toEqual({
      kwh: 33,
      estimated: true,
    });
    expect(sessionEnergy({ energyKwh: null, estimatedEnergyKwh: null })).toBeNull();
  });
});

describe('averagePowerKw', () => {
  it('is energy over the hours spent charging', () => {
    expect(averagePowerKw(30, 4 * 3600)).toBe(7.5);
    expect(averagePowerKw(null, 3600)).toBeNull();
    expect(averagePowerKw(1, 10)).toBeNull();
  });
});
