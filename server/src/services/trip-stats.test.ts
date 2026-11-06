import { describe, expect, it } from 'vitest';
import type { ChargingSessionDto, DriveDto } from '../api-types.js';
import { tripStats } from './trip-stats.js';

const drive = (over: Partial<DriveDto> = {}) =>
  ({
    id: 1,
    startedAt: '2026-06-01T10:00:00.000Z',
    endedAt: '2026-06-01T11:00:00.000Z',
    distanceKm: 100,
    energyKwh: 25,
    ...over,
  }) as DriveDto;

const session = (over: Partial<ChargingSessionDto> = {}) =>
  ({
    id: 1,
    startedAt: '2026-06-01T11:30:00.000Z',
    endedAt: '2026-06-01T23:00:00.000Z',
    chargingSeconds: 1800,
    energyKwh: 40,
    estimatedEnergyKwh: null,
    cost: '20.00',
    estimatedCost: null,
    currency: 'USD',
    ...over,
  }) as ChargingSessionDto;

describe('tripStats', () => {
  it('is empty with no activities', () => {
    const stats = tripStats([], [], 'USD');
    expect(stats).toMatchObject({ drives: 0, charges: 0, startedAt: null, efficiency: null });
    expect(stats.costs).toEqual([]);
  });

  it('ends its days when the last activity began, not when an overnight charge finished', () => {
    const stats = tripStats(
      [drive()],
      [session({ startedAt: '2026-06-01T20:00:00.000Z', endedAt: '2026-06-02T09:00:00.000Z' })],
      'USD',
    );
    expect(stats.endedAt).toBe('2026-06-02T09:00:00.000Z');
    expect(stats.lastStartedAt).toBe('2026-06-01T20:00:00.000Z');
  });

  it('adds up drives and charges, spanning first start to last end', () => {
    const stats = tripStats(
      [
        drive(),
        drive({
          id: 2,
          startedAt: '2026-06-03T10:00:00.000Z',
          endedAt: '2026-06-03T10:30:00.000Z',
        }),
      ],
      [session()],
      'USD',
    );
    expect(stats).toMatchObject({
      drives: 2,
      charges: 1,
      startedAt: '2026-06-01T10:00:00.000Z',
      endedAt: '2026-06-03T10:30:00.000Z',
      lastStartedAt: '2026-06-03T10:00:00.000Z',
      distanceKm: 200,
      drivingSeconds: 5400,
      energyUsedKwh: 50,
      energyAddedKwh: 40,
    });
  });

  it('counts time charging, never time plugged in', () => {
    expect(tripStats([], [session()], 'USD').chargingSeconds).toBe(1800);
  });

  it('leaves a charge without a known time out, and says so', () => {
    const stats = tripStats([], [session(), session({ id: 2, chargingSeconds: null })], 'USD');
    expect(stats).toMatchObject({ chargingSeconds: 1800, chargesWithTime: 1, charges: 2 });
  });

  it('counts a drive downhill that gained battery as using none', () => {
    const stats = tripStats(
      [drive(), drive({ id: 2, energyKwh: null, startBattery: 54, endBattery: 57, distanceKm: 9 })],
      [],
      'USD',
    );
    expect(stats.efficiency).toEqual({ distanceKm: 109, energyKwh: 25, drives: 2 });
    expect(stats.energyUsedKwh).toBe(25);
  });

  it('works efficiency out only from drives with both figures', () => {
    const stats = tripStats(
      [
        drive(),
        // No battery readings: nothing to go on, so it can't count.
        drive({ id: 2, energyKwh: null, startBattery: null, distanceKm: 50 }),
        drive({ id: 3, energyKwh: 10, distanceKm: null }),
      ],
      [],
      'USD',
    );
    expect(stats.efficiency).toEqual({ distanceKm: 100, energyKwh: 25, drives: 1 });
    expect(stats.distanceKm).toBe(150);
    expect(stats.drivesWithDistance).toBe(2);
    expect(stats.energyUsedKwh).toBe(35);
  });

  it('marks energy added as estimated when any of it is', () => {
    const stats = tripStats(
      [],
      [session(), session({ id: 2, energyKwh: null, estimatedEnergyKwh: 10 })],
      'USD',
    );
    expect(stats).toMatchObject({
      energyAddedKwh: 50,
      energyAddedEstimated: true,
      chargesWithEnergy: 2,
    });
  });

  it('keeps a total per currency, and a cost with none in the default one', () => {
    const stats = tripStats(
      [],
      [
        session(),
        session({ id: 2, cost: '30.00', currency: 'CAD' }),
        session({ id: 3, cost: '5.00', currency: null }),
        session({ id: 4, cost: null, estimatedCost: '2.50', currency: 'USD' }),
        session({ id: 5, cost: null, estimatedCost: null, currency: null }),
      ],
      'USD',
    );
    expect(stats.costs).toEqual([
      { currency: 'USD', amount: 27.5, estimated: true },
      { currency: 'CAD', amount: 30, estimated: false },
    ]);
    expect(stats.chargesWithCost).toBe(4);
  });
});
