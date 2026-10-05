import { afterEach, describe, expect, it, vi } from "vitest";
import { MockRivian } from "./mock.js";
import { decodeGnss, RVM_GNSS, type GnssReading } from "./parallax.js";

afterEach(() => vi.useRealTimers());

describe("mock dynamics GPS", () => {
  it("moves during a drive and reports zero speed when parked again", () => {
    vi.useFakeTimers();
    const mock = new MockRivian();
    const readings: GnssReading[] = [];
    mock.subscribeParallaxDynamics("mock", [RVM_GNSS], (_id, message) => {
      if (message.rvm === RVM_GNSS) readings.push(decodeGnss(message.payload)!);
    });
    try {
      mock.start();
      const initial = readings.at(-1)!;
      expect(initial.speedMps).toBe(0);
      vi.advanceTimersByTime(40_000);
      const moving = readings.at(-1)!;
      expect(moving.speedMps).toBeGreaterThan(1);
      expect([moving.latitude, moving.longitude]).not.toEqual([initial.latitude, initial.longitude]);
      expect(readings.length).toBeGreaterThan(2);
      vi.advanceTimersByTime(180_000);
      expect(readings.at(-1)!.speedMps).toBe(0);
    } finally {
      mock.stop();
    }
  });
});
