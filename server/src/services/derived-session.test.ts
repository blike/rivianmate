import { describe, expect, it } from "vitest";
import { derivedLiveSession } from "./derived-session.js";

const inputs = {
  chargerState: "charging_active",
  soc: 88,
  minutesLeft: 23,
  stateAt: "2026-10-02T12:36:00.000Z",
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
  });
});
