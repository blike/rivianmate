import type { VehicleState } from '@server/api-types';
import { describe, expect, it } from 'vitest';
import { showOptional } from './fieldSources';

const FIELD = 'batteryPowerOutputStatus' as const;

const state = (fields: Record<string, string | number>) =>
  Object.fromEntries(
    Object.entries(fields).map(([k, value]) => [k, { timeStamp: 't', value }]),
  ) as unknown as VehicleState;

describe('the power output verdict field', () => {
  it('is optional, shown once the vehicle has sent one', () => {
    expect(showOptional(state({ batteryPowerOutputStatus: 'cold' }), FIELD)).toBe(true);
  });

  it('is left out for a vehicle that never sends one', () => {
    expect(showOptional(state({ batteryLevel: 61 }), FIELD)).toBe(false);
  });
});
