import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockRivian } from './mock.js';
import {
  decodeGnss,
  decodeTripInfo,
  RVM_GNSS,
  RVM_TRIP_INFO,
  type GnssReading,
  type TripInfo,
} from './parallax/index.js';

afterEach(() => vi.useRealTimers());

describe('mock dynamics GPS', () => {
  it('moves during a drive and reports zero speed when parked again', () => {
    vi.useFakeTimers();
    const mock = new MockRivian();
    const readings: GnssReading[] = [];
    mock.subscribeParallax(
      'mock',
      [RVM_GNSS],
      (_id, message) => {
        if (message.rvm === RVM_GNSS) readings.push(decodeGnss(message.payload)!);
      },
      'dynamics',
    );
    try {
      mock.start();
      const initial = readings.at(-1)!;
      expect(initial.speedMps).toBe(0);
      vi.advanceTimersByTime(40_000);
      const moving = readings.at(-1)!;
      expect(moving.speedMps).toBeGreaterThan(1);
      expect([moving.latitude, moving.longitude]).not.toEqual([
        initial.latitude,
        initial.longitude,
      ]);
      expect(readings.length).toBeGreaterThan(2);
      vi.advanceTimersByTime(180_000);
      expect(readings.at(-1)!.speedMps).toBe(0);
    } finally {
      mock.stop();
    }
  });
});

describe('mock navigation', () => {
  it('sends a trip with its predicted arrival and route, as the vehicle lays them out', () => {
    vi.useFakeTimers();
    const mock = new MockRivian();
    const trips: (TripInfo | null)[] = [];
    mock.subscribeParallax(
      'mock',
      [RVM_TRIP_INFO],
      (_id, message) => {
        if (message.rvm === RVM_TRIP_INFO) trips.push(decodeTripInfo(message.payload));
      },
      'core',
    );
    try {
      mock.start();
      vi.advanceTimersByTime(40_000);
      const trip = trips.find((t) => t != null)!;
      expect(trip.arrivalSoc).toBeGreaterThan(5);
      expect(trip.arrivalRangeKm).toBeCloseTo(trip.arrivalSoc! * 4.4, 3);
      expect(trip.arrivalAtMs).toBeGreaterThan(Date.now());
      expect(trip.route!.length).toBeGreaterThan(10);
      expect(trip.route![0]).toEqual([trip.destination.lat, trip.destination.lon]);
    } finally {
      mock.stop();
    }
  });
});
