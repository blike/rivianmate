import { describe, expect, it } from "vitest";
import { type DerivedChargeInputs, derivedLiveSession, emptyChargeInputs } from "./derived-session.js";

const inputs: DerivedChargeInputs = {
  ...emptyChargeInputs("2026-10-02T12:36:00.000Z"),
  chargerState: "charging_active",
  soc: 88,
  socAt: "2026-10-02T12:36:00.000Z",
  minutesLeft: 23,
  powerKw: 7.4,
  powerAt: "2026-10-02T12:38:21.000Z",
  energyKwh: 40.4,
  energyAt: "2026-10-02T12:30:00.000Z",
};

describe("derivedLiveSession", () => {
  it("reports power, SoC, energy and time left (in seconds, like the push feed)", () => {
    const s = derivedLiveSession(Date.parse("2026-10-02T03:58:09Z"), inputs)!;
    expect(s.vehicleChargerState?.value).toBe("charging_active");
    expect(s.power).toEqual({ value: 7.4, updatedAt: inputs.powerAt });
    expect(s.soc?.value).toBe(88);
    expect(s.totalChargedEnergy?.value).toBe(40.4);
    expect(s.timeRemaining?.value).toBe(23 * 60);
    expect(s.startTime).toBe("2026-10-02T03:58:09.000Z");
  });

  it("is null unless charging, and leaves out what isn't known", () => {
    expect(derivedLiveSession(0, { ...inputs, chargerState: "charging_scheduled" })).toBeNull();
    const s = derivedLiveSession(0, { ...inputs, minutesLeft: 0, powerKw: null, powerAt: null })!;
    expect(s.timeRemaining).toBeNull();
    expect(s.power).toBeNull();
    expect(s.kilometersChargedPerHour).toBeNull();
    expect(s.socLimit).toBeNull();
  });

  it("prefers Parallax's readings once it reports", () => {
    const s = derivedLiveSession(0, {
      ...inputs,
      parallaxSoc: 88.4,
      parallaxSocAt: "2026-10-02T12:37:00.000Z",
      capacityKwh: 111.485,
      parallaxMinutesLeft: 21,
      parallaxMinutesAt: "2026-10-02T12:37:00.000Z",
      socLimit: 95,
      socLimitAt: "2026-10-02T12:00:00.000Z",
      rangeAddedKm: 194,
      rangeKmPerHour: 31,
      rateAt: "2026-10-02T12:37:00.000Z",
    })!;
    expect(s.soc?.value).toBe(88.4);
    expect(s.timeRemaining?.value).toBe(21 * 60);
    expect(s.socLimit?.value).toBe(95);
    expect(s.batteryCapacityKwh?.value).toBe(111.485);
    expect(s.rangeAddedThisSession?.value).toBe(194);
    expect(s.kilometersChargedPerHour?.value).toBe(31);
  });

  it("drops the time left once Parallax clears its estimate", () => {
    const s = derivedLiveSession(0, { ...inputs, parallaxMinutesLeft: null, parallaxMinutesAt: "2026-10-02T12:37:00.000Z" })!;
    expect(s.timeRemaining).toBeNull();
  });

  it("takes whichever SOC changed last", () => {
    const s = derivedLiveSession(0, {
      ...inputs,
      soc: 88.6,
      socAt: "2026-10-02T12:40:00.000Z",
      parallaxSoc: 88.4,
      parallaxSocAt: "2026-10-02T12:37:00.000Z",
    })!;
    expect(s.soc?.value).toBe(88.6);
  });

  it("follows Parallax's charging status when it changed last", () => {
    const ready = { ...inputs, chargerState: "charging_ready", chargerStateAt: "2026-10-02T12:36:00.000Z" };
    expect(derivedLiveSession(0, ready)).toBeNull();
    const started = { ...ready, parallaxChargerState: "charging_active", parallaxChargerStateAt: "2026-10-02T12:36:30.000Z" };
    expect(derivedLiveSession(0, started)?.vehicleChargerState?.value).toBe("charging_active");
    const stopped = { ...started, chargerState: "charging_complete", chargerStateAt: "2026-10-02T12:50:00.000Z" };
    expect(derivedLiveSession(0, stopped)).toBeNull();
  });
});
