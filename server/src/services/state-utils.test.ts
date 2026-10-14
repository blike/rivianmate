import { describe, expect, it } from 'vitest';
import type { VehicleState } from '../rivian/types.js';
import { PARALLAX_STATE_FIELDS } from '../rivian/parallax/index.js';
import { isPosition, mergeVehicleState, normalizeReadings, stateLocation } from './state-utils.js';

describe('stateLocation', () => {
  const at = (latitude: number, longitude: number) =>
    stateLocation({ gnssLocation: { latitude, longitude, timeStamp: '2026-10-04T16:00:00Z' } });

  it('returns a real fix', () => {
    expect(at(34.0026, -116.0522)?.latitude).toBe(34.0026);
  });

  it('drops the 0,0 Rivian sends without a fix, and impossible positions', () => {
    expect(at(0, 0)).toBeNull();
    expect(at(0.00001, -0.00002)).toBeNull();
    expect(at(91, 10)).toBeNull();
    expect(at(10, -181)).toBeNull();
    expect(at(Number.NaN, 10)).toBeNull();
  });

  it('keeps real places near the equator or the prime meridian', () => {
    expect(isPosition(0, 32.5)).toBe(true); // Lake Victoria
    expect(isPosition(51.48, 0)).toBe(true); // Greenwich
  });
});

describe('GPS and tire stream fallback', () => {
  it('accepts legacy-only fields and keeps the newest readings as sources change', () => {
    const cached: VehicleState = {};
    const oldAt = '2026-10-04T10:00:00Z';
    const at = '2026-10-04T10:01:00Z';
    const nextAt = '2026-10-04T10:02:00Z';
    // Legacy remains usable when dynamics has never delivered (including rejection).
    mergeVehicleState(cached, { gnssSpeed: { timeStamp: oldAt, value: 5 } }, PARALLAX_STATE_FIELDS);
    expect(cached.gnssSpeed?.value).toBe(5);
    // A newer Parallax reading takes over.
    mergeVehicleState(cached, { gnssSpeed: { timeStamp: at, value: 10 } }, PARALLAX_STATE_FIELDS);
    // A delayed legacy speed must not roll it back; an unreported tire still updates.
    mergeVehicleState(
      cached,
      {
        gnssSpeed: { timeStamp: oldAt, value: 0 },
        tirePressureFrontLeft: { timeStamp: oldAt, value: 2.8 },
      },
      PARALLAX_STATE_FIELDS,
    );
    expect(cached.gnssSpeed?.value).toBe(10);
    expect(cached.tirePressureFrontLeft?.value).toBe(2.8);
    // After dynamics stops, newer legacy data remains usable.
    mergeVehicleState(
      cached,
      { gnssSpeed: { timeStamp: nextAt, value: 0 } },
      PARALLAX_STATE_FIELDS,
    );
    expect(cached.gnssSpeed?.value).toBe(0);
  });

  it('protects compound GPS locations from delayed readings in either stream', () => {
    const current = { latitude: 34, longitude: -116, timeStamp: '2026-10-04T10:01:00Z' };
    const cached: VehicleState = { gnssLocation: current };
    mergeVehicleState(
      cached,
      {
        gnssLocation: { latitude: 35, longitude: -117, timeStamp: '2026-10-04T10:00:00Z' },
      },
      PARALLAX_STATE_FIELDS,
    );
    expect(cached.gnssLocation).toEqual(current);
  });
});

describe('normalizeReadings', () => {
  const at = (value: string | number) => ({ timeStamp: '2026-10-12T23:36:02Z', value });

  it('drops float32 noise and puts bearing on a 0–360 compass', () => {
    const location = { latitude: 33.0714452, longitude: -117.2565921, timeStamp: 'x' };
    expect(
      normalizeReadings({
        batteryLevel: at(53.600002),
        gnssBearing: at(-169.853),
        gnssSpeed: at(4.951428413391113),
        gearStatus: at('park'),
        gnssLocation: location,
      }),
    ).toEqual({
      batteryLevel: at(53.6),
      gnssBearing: at(190.147),
      gnssSpeed: at(4.951),
      gearStatus: at('park'),
      gnssLocation: location,
    });
    expect(normalizeReadings({ gnssBearing: at(359.9999) }).gnssBearing).toEqual(at(0));
  });
});

describe('invalid sensor states', () => {
  it('drops "undefined" except where it is a reading (preconditioning off)', () => {
    const cached: VehicleState = {
      cabinPreconditioningStatus: { timeStamp: 'a', value: 'active' },
      driveMode: { timeStamp: 'a', value: 'everyday' },
    };
    const changed = mergeVehicleState(cached, {
      cabinPreconditioningStatus: { timeStamp: 'b', value: 'undefined' },
      driveMode: { timeStamp: 'b', value: 'undefined' },
    });
    expect(changed).toEqual(['cabinPreconditioningStatus']);
    expect(cached.driveMode).toEqual({ timeStamp: 'a', value: 'everyday' });
  });
});

describe('mergeVehicleState', () => {
  it('merges deltas and reports changed keys', () => {
    const cached: VehicleState = {
      batteryLevel: { timeStamp: 't0', value: 50 },
    };
    const changed = mergeVehicleState(cached, {
      batteryLevel: { timeStamp: 't1', value: 51 },
      powerState: { timeStamp: 't1', value: 'go' },
    });
    expect(changed.sort()).toEqual(['batteryLevel', 'powerState']);
    expect((cached.batteryLevel as { value: unknown }).value).toBe(51);
  });

  it('drops invalid sensor values, keeping the previous one', () => {
    const cached: VehicleState = {
      chargerStatus: { timeStamp: 't0', value: 'chrgr_sts_not_connected' },
    };
    const changed = mergeVehicleState(cached, {
      chargerStatus: { timeStamp: 't1', value: 'signal_not_available' },
    });
    expect(changed).toEqual([]);
    expect((cached.chargerStatus as { value: unknown }).value).toBe('chrgr_sts_not_connected');
  });

  it('does not report unchanged values', () => {
    const cached: VehicleState = {
      powerState: { timeStamp: 't0', value: 'sleep' },
    };
    const changed = mergeVehicleState(cached, {
      powerState: { timeStamp: 't0', value: 'sleep' },
    });
    expect(changed).toEqual([]);
  });
});
