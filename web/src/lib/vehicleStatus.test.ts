import type { VehicleState } from '@server/api-types';
import { describe, expect, it } from 'vitest';
import {
  brakeFluidLabel,
  chargePortLabel,
  climateRunning,
  coldRangeNote,
  preconditioningCause,
  preconditioningLabel,
  rangeLevel,
  securitySummary,
  twelveVoltLabel,
  vehicleActivity,
} from './vehicleStatus';

const v = (value: string | number) => ({ timeStamp: 't', value });
const state = (fields: Record<string, string | number>) =>
  Object.fromEntries(Object.entries(fields).map(([k, x]) => [k, v(x)])) as unknown as VehicleState;

describe('vehicleActivity', () => {
  it('prefers driving, then charging, then plugged in, asleep, parked', () => {
    expect(
      vehicleActivity(state({ gearStatus: 'drive', chargerStatus: 'chrgr_sts_connected_charging' }))
        ?.kind,
    ).toBe('driving');
    expect(vehicleActivity(state({ powerState: 'go', gnssSpeed: 5 }))?.kind).toBe('driving');
    expect(
      vehicleActivity(state({ gearStatus: 'park', chargerStatus: 'chrgr_sts_connected_charging' }))
        ?.kind,
    ).toBe('charging');
    expect(
      vehicleActivity(state({ powerState: 'sleep', chargerStatus: 'chrgr_sts_connected_no_chrg' }))
        ?.kind,
    ).toBe('plugged');
    expect(
      vehicleActivity(state({ powerState: 'sleep', chargerStatus: 'chrgr_sts_not_connected' }))
        ?.kind,
    ).toBe('asleep');
    expect(vehicleActivity(state({ powerState: 'ready', gearStatus: 'park' }))?.kind).toBe(
      'parked',
    );
    expect(vehicleActivity(undefined)).toBeNull();
  });
});

describe('securitySummary', () => {
  it('is locked only when every reported lock is locked', () => {
    const locked = state({
      doorFrontLeftClosed: 'closed',
      doorFrontLeftLocked: 'locked',
      closureFrunkClosed: 'closed',
      closureFrunkLocked: 'locked',
    });
    expect(securitySummary(locked, 'R1S')).toMatchObject({
      locked: true,
      open: [],
      openLabel: 'All closed',
    });
    const unlocked = state({
      doorFrontLeftClosed: 'closed',
      doorFrontLeftLocked: 'locked',
      closureFrunkClosed: 'closed',
      closureFrunkLocked: 'unlocked',
    });
    expect(securitySummary(unlocked, 'R1S').locked).toBe(false);
    expect(securitySummary(state({}), 'R1S').locked).toBeNull();
  });

  it('names a single opening and counts several', () => {
    expect(securitySummary(state({ closureLiftgateClosed: 'open' }), 'R1S').openLabel).toBe(
      'Liftgate open',
    );
    expect(
      securitySummary(
        state({ closureLiftgateClosed: 'open', windowFrontLeftClosed: 'open' }),
        'R1S',
      ).openLabel,
    ).toBe('2 open');
  });
});

describe('dashboard warning labels', () => {
  it('reads brake fluid as normal only from a vehicle with fluid sensors', () => {
    expect(brakeFluidLabel(undefined)).toBe('Unknown');
    // As an R2: no legacy fluid readings at all.
    expect(brakeFluidLabel({})).toBe('Unknown');
    // As an R1S: washer fluid reported, brake fluid empty while it's fine.
    expect(brakeFluidLabel(state({ wiperFluidState: 'normal' }))).toBe('Normal');
    expect(brakeFluidLabel(state({ brakeFluidLow: 'false' }))).toBe('OK');
    expect(brakeFluidLabel(state({ brakeFluidLow: 'true' }))).toBe('Low');
  });

  it('reads 12V battery health as words', () => {
    expect(twelveVoltLabel(state({ twelveVoltBatteryHealth: 'NORMAL_OPERATION' }))).toBe('Normal');
    expect(twelveVoltLabel(state({ twelveVoltBatteryHealth: 'LOW_VOLTAGE' }))).toBe('Low Voltage');
    expect(twelveVoltLabel(undefined)).toBe('—');
  });

  it('reads the charge port\'s "close" as Closed', () => {
    expect(chargePortLabel(state({ chargePortState: 'close' }))).toBe('Closed');
    expect(chargePortLabel(state({ chargePortState: 'open' }))).toBe('Open');
    expect(chargePortLabel(state({ chargePortState: 'opening' }))).toBe('Opening');
    expect(chargePortLabel(undefined)).toBe('—');
  });

  it('maps the observed inactive preconditioning enum without masking missing or active values', () => {
    expect(preconditioningLabel(state({ cabinPreconditioningStatus: 'undefined' }))).toBe('Off');
    expect(preconditioningLabel(undefined)).toBe('Unknown');
    expect(
      preconditioningLabel({ cabinPreconditioningStatus: null } as unknown as VehicleState),
    ).toBe('Unknown');
    expect(preconditioningLabel(state({ cabinPreconditioningStatus: 'active' }))).toBe('Active');
    expect(preconditioningLabel(state({ cabinPreconditioningStatus: 'complete_maintain' }))).toBe(
      'Holding temperature',
    );
  });

  it('counts the climate running only while preconditioning runs', () => {
    const running = (status: string) =>
      climateRunning(state({ cabinPreconditioningStatus: status }));
    expect(['initiate', 'active', 'active_warning', 'complete_maintain'].every(running)).toBe(true);
    // Legacy reports unavailable while driving.
    expect(['undefined', 'unavailable', 'timeout_complete', 'error_soc_low'].some(running)).toBe(
      false,
    );
    expect(
      climateRunning(state({ climateOn: 'true', cabinPreconditioningStatus: 'undefined' })),
    ).toBe(true);
  });
});

describe('preconditioningCause', () => {
  it('says what started preconditioning, only while it runs', () => {
    const cause = (status: string, type: string) =>
      preconditioningCause(
        state({ cabinPreconditioningStatus: status, cabinPreconditioningType: type }),
      );
    expect(cause('active', 'SCHEDULED')).toBe('departure schedule');
    expect(cause('complete_maintain', 'USER_SELECTED')).toBe('started by you');
    expect(cause('undefined', 'SCHEDULED')).toBeNull();
    expect(cause('active', 'NONE')).toBeNull();
  });
});

describe('range notes', () => {
  it('flags low range, and says nothing when it is normal or unknown', () => {
    expect(rangeLevel(state({ rangeThreshold: 'low' }))).toEqual({
      label: 'Low range',
      level: 'warning',
    });
    expect(rangeLevel(state({ rangeThreshold: 'critically_low' }))).toEqual({
      label: 'Critically low range',
      level: 'critical',
    });
    expect(rangeLevel(state({ rangeThreshold: 'normal' }))).toBeNull();
    expect(rangeLevel(undefined)).toBeNull();
  });

  it('says when the cold is affecting range', () => {
    expect(coldRangeNote(state({ rangeTemperatureImpact: 'cold_impact' }))).toBe(
      'Reduced by the cold',
    );
    expect(coldRangeNote(state({ rangeTemperatureImpact: 'cold_may_impact' }))).toBe(
      'The cold may reduce it',
    );
    expect(coldRangeNote(state({ rangeTemperatureImpact: 'normal' }))).toBeNull();
  });
});
