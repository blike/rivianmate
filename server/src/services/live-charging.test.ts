import { describe, expect, it } from "vitest";
import { LiveChargeState, STALE_MS } from "./live-charging.js";

const T = Date.parse("2026-10-02T23:10:00Z");
const START = T - 10 * 60_000;

function charging(source: "state" | "parallax" | "push" = "state", at = T): LiveChargeState {
  const live = new LiveChargeState();
  live.observe("chargerState", source, "charging_active", at, at);
  return live;
}

describe("LiveChargeState", () => {
  it("is null unless the latest charger state says it's charging", () => {
    const live = new LiveChargeState();
    expect(live.session(START, T)).toBeNull();
    live.observe("chargerState", "state", "charging_active", T, T);
    expect(live.session(START, T)).not.toBeNull();
    live.observe("chargerState", "parallax", "charging_complete", T + 1_000, T + 1_000);
    expect(live.session(START, T + 1_000)).toBeNull();
  });

  it("counts the push feed's own active states as charging", () => {
    const live = new LiveChargeState();
    live.observe("chargerState", "push", "charging_ready", T, T);
    expect(live.isCharging(T)).toBe(true);
  });

  it("takes each field's newest reading across sources", () => {
    const live = charging();
    live.observe("powerKw", "push", 124.7, T, T + 5_000);
    live.observe("powerKw", "parallax", 109.8, T + 4_000, T + 5_000);
    expect(live.session(START, T + 5_000)?.power?.value).toBe(109.8);
  });

  it("breaks ties by source: push, then Parallax, then vehicle state", () => {
    const live = charging();
    live.observe("powerKw", "parallax", 110, T, T);
    live.observe("powerKw", "push", 111, T, T);
    expect(live.resolve("powerKw", T)).toMatchObject({ value: 111, source: "push" });
  });

  it("ignores a reading older than one the same source already gave", () => {
    const live = charging();
    expect(live.observe("powerKw", "parallax", 120, T + 10_000, T + 10_000)).toBe(true);
    expect(live.observe("powerKw", "parallax", 60, T, T + 11_000)).toBe(false);
    expect(live.resolve("powerKw", T + 11_000)?.value).toBe(120);
  });

  it("never dates a reading in the future", () => {
    const live = charging();
    live.observe("powerKw", "parallax", 50, T + 3_600_000, T);
    expect(live.resolve("powerKw", T)?.at).toBe(T);
  });

  it("forgets readings too old to trust, but keeps lasting facts", () => {
    const live = charging();
    live.observe("powerKw", "parallax", 11, T, T);
    live.observe("socLimit", "parallax", 80, T, T);
    const later = T + STALE_MS + 1;
    expect(live.session(START, later)?.power).toBeNull();
    expect(live.session(START, later)?.socLimit?.value).toBe(80);
  });

  it("keeps the last real readings when the push feed flaps mid-charge", () => {
    const live = charging();
    live.observe("powerKw", "parallax", 118, T, T);
    live.observe("chargerState", "push", "charging_active", T + 1_000, T + 1_000);
    live.observe("powerKw", "push", 124.7, T + 1_000, T + 1_000);
    live.clearPush();
    // Still charging per vehicle state; the newest real power, not 0 or "—".
    expect(live.session(START, T + 2_000)?.power?.value).toBe(124.7);
    live.observe("powerKw", "parallax", 119, T + 3_000, T + 3_000);
    expect(live.session(START, T + 3_000)?.power?.value).toBe(119);
  });

  it("stops vouching for a charge once the push feed says it's over", () => {
    const live = new LiveChargeState();
    live.observe("chargerState", "push", "charging_active", T, T);
    expect(live.isCharging(T)).toBe(true);
    live.clearPush();
    expect(live.isCharging(T)).toBe(false);
  });

  it("dates a lasting value from when it changed, not each re-report", () => {
    const live = new LiveChargeState();
    live.observe("chargerState", "state", "charging_active", T, T);
    live.observe("chargerState", "parallax", "charging_complete", T + 60_000, T + 60_000);
    // Vehicle state re-stamps the unchanged value on its next report.
    live.observe("chargerState", "state", "charging_active", T + 120_000, T + 120_000);
    expect(live.isCharging(T + 120_000)).toBe(false);
  });

  it("drops time left of 0 (no estimate)", () => {
    const live = charging();
    live.observe("secondsLeft", "parallax", 0, T, T);
    expect(live.session(START, T)?.timeRemaining).toBeNull();
    live.observe("secondsLeft", "parallax", 2520, T + 1_000, T + 1_000);
    expect(live.session(START, T + 1_000)?.timeRemaining?.value).toBe(2520);
  });

  it("forgets a finished charge's figures but keeps the new one's", () => {
    const live = charging();
    live.observe("energyKwh", "parallax", 40, T, T);
    live.observe("powerKw", "parallax", 7, T + 5_000, T + 5_000);
    live.forgetSessionReadings(T + 1_000);
    expect(live.resolve("energyKwh", T + 6_000)).toBeNull();
    expect(live.resolve("powerKw", T + 6_000)?.value).toBe(7);
  });
});
