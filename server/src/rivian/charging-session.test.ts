import { describe, expect, it } from "vitest";
import { isActiveSession } from "../services/charging-monitor.js";
import { mapChargingSession } from "./charging-session.js";

const now = () => new Date("2026-08-18T12:05:00Z");

describe("mapChargingSession", () => {
  it("maps scalar leaves", () => {
    const session = mapChargingSession(
      {
        liveData: {
          powerKW: "11.5",
          kilometersChargedPerHour: 68,
          rangeAddedThisSession: "42.25",
          totalChargedEnergy: 7.5,
          timeElapsed: "120",
          timeRemaining: 360,
          price: "1.25",
          currency: "USD",
          isFreeSession: "false",
          vehicleChargerState: "charging_active",
          startTime: "2026-08-18T12:00:00Z",
        },
        chartData: [
          { soc: "54", powerKW: 10 },
          { soc: "55", powerKW: 11 },
        ],
      },
      now,
    );
    expect(session).not.toBeNull();
    expect(session!.power).toEqual({ value: 11.5, updatedAt: now().toISOString() });
    expect(session!.totalChargedEnergy?.value).toBe(7.5);
    expect(session!.soc?.value).toBe(55);
    expect(session!.currentPrice).toBe(1.25);
    expect(session!.isFreeSession).toBe(false);
    expect(session!.startTime).toBe("2026-08-18T12:00:00Z");
    expect(isActiveSession(session)).toBe(true);
    expect(session!.chart).toEqual([]);
  });

  it("keeps timestamped chart points as curve samples", () => {
    const session = mapChargingSession(
      {
        liveData: { powerKW: 11 },
        chartData: [
          { soc: "54", powerKW: 10.5, startTime: "2026-08-18T12:00:00Z" },
          { soc: { value: 55 }, powerKW: { value: 11 }, startTime: { value: "2026-08-18T12:01:00Z" } },
          { soc: 56, powerKW: 11 },
        ],
      },
      now,
    );
    expect(session!.chart).toEqual([
      { ts: "2026-08-18T12:00:00Z", powerKw: 10.5, soc: 54 },
      { ts: "2026-08-18T12:01:00Z", powerKw: 11, soc: 55 },
    ]);
  });

  it("maps value envelopes and keeps their timestamps", () => {
    const session = mapChargingSession(
      {
        liveData: {
          powerKW: { value: 9.6, updatedAt: "2026-08-18T12:00:00Z" },
          totalChargedEnergy: { value: "12.5" },
          vehicleChargerState: { value: "Charging" },
        },
        chartData: [{ soc: { value: 66 } }],
      },
      now,
    );
    expect(session!.power).toEqual({ value: 9.6, updatedAt: "2026-08-18T12:00:00Z" });
    expect(session!.totalChargedEnergy?.value).toBe(12.5);
    expect(session!.soc?.value).toBe(66);
    expect(isActiveSession(session)).toBe(true);
  });

  it("returns null when there is no live session", () => {
    expect(mapChargingSession(null)).toBeNull();
    expect(mapChargingSession({ liveData: null, chartData: [] })).toBeNull();
  });
});
