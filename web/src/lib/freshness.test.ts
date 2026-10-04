import { describe, expect, it } from "vitest";
import { freshness, lastSeenAt, locationIsBehind } from "./freshness.js";

const NOW = Date.parse("2026-10-01T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const v = (ts: string) => ({ timeStamp: ts, value: 1 });

describe("freshness", () => {
  it("uses the newest timestamp across fields and cloud sync", () => {
    const state = {
      cloudConnection: { lastSync: ago(30), isOnline: true },
      batteryLevel: v(ago(2)),
      vehicleMileage: v(ago(90)),
    };
    expect(lastSeenAt(state)?.toISOString()).toBe(ago(2));
  });

  it("is live when online and recently updated", () => {
    const f = freshness({ cloudConnection: { lastSync: ago(1), isOnline: true } }, NOW);
    expect(f.level).toBe("live");
    expect(f.label).toBe("Online · updated 1 min ago");
  });

  it("shows asleep when the vehicle is offline", () => {
    const f = freshness({ cloudConnection: { lastSync: ago(180), isOnline: false } }, NOW);
    expect(f.level).toBe("asleep");
    expect(f.label).toBe("Asleep · last seen 3 h ago");
  });

  it("flags data older than a day as stale even if marked online", () => {
    const f = freshness({ cloudConnection: { lastSync: ago(60 * 50), isOnline: true } }, NOW);
    expect(f.level).toBe("stale");
    expect(f.label).toContain("2 days ago");
  });

  it("handles no state", () => {
    expect(freshness(undefined, NOW).label).toBe("No data yet");
  });
});

describe("locationIsBehind", () => {
  const loc = (ts: string) => ({ latitude: 34, longitude: -116, timeStamp: ts });

  it("flags a fix well behind the vehicle's other readings", () => {
    // Oct 4 morning: gear updating live, GPS still yesterday's.
    expect(locationIsBehind({ gearStatus: v(ago(1)), gnssLocation: loc(ago(19 * 60)) })).toBe(true);
  });

  it("ignores the other GPS fields, which go stale with the fix", () => {
    expect(locationIsBehind({ gnssSpeed: v(ago(1)), gnssLocation: loc(ago(60)) })).toBe(false);
  });

  it("accepts a fix that keeps up", () => {
    expect(locationIsBehind({ gearStatus: v(ago(1)), gnssLocation: loc(ago(3)) })).toBe(false);
    expect(locationIsBehind({ gnssLocation: loc(ago(600)) })).toBe(false);
  });
});
