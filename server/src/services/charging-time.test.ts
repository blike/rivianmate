import { describe, expect, it } from "vitest";
import type { VehicleState } from "../rivian/types.js";
import {
  chargingSecondsBetween,
  deriveChargingStats,
  isChargingState,
  socReadingsBetween,
  stampedAt,
} from "./charging-time.js";

const t = (iso: string) => Date.parse(iso);
const state = (chargerState: [string, string], battery?: [number, string]): VehicleState => ({
  chargerState: { value: chargerState[0], timeStamp: chargerState[1] },
  ...(battery ? { batteryLevel: { value: battery[0], timeStamp: battery[1] } } : {}),
});

describe("isChargingState", () => {
  it("only counts energy flowing as charging", () => {
    expect(isChargingState("charging_active")).toBe(true);
    for (const s of ["charging_scheduled", "charging_complete", "charging_ready", null]) {
      expect(isChargingState(s)).toBe(false);
    }
  });
});

describe("stampedAt", () => {
  const now = t("2026-10-01T12:00:00Z");
  it("uses Rivian's timestamp, falling back when missing or in the future", () => {
    const s = state(["charging_active", "2026-10-01T11:00:00Z"]);
    expect(stampedAt(s, "chargerState", now)).toBe(t("2026-10-01T11:00:00Z"));
    expect(stampedAt({}, "chargerState", now)).toBe(now);
    const future = state(["charging_active", "2026-10-01T13:00:00Z"]);
    expect(stampedAt(future, "chargerState", now)).toBe(now);
  });
});

describe("chargingSecondsBetween", () => {
  const start = t("2026-10-01T00:00:00Z");
  const end = t("2026-10-01T06:00:00Z");

  it("sums every charging stretch within one plug-in", () => {
    const readings = [
      { at: t("2026-10-01T01:00:00Z"), charging: true },
      { at: t("2026-10-01T02:00:00Z"), charging: false },
      { at: t("2026-10-01T04:00:00Z"), charging: true },
      { at: t("2026-10-01T04:30:00Z"), charging: false },
    ];
    expect(chargingSecondsBetween(readings, start, end)).toBe(90 * 60);
  });

  it("clamps to the session and runs an open stretch to `until`", () => {
    const readings = [{ at: t("2026-09-30T23:00:00Z"), charging: true }];
    expect(chargingSecondsBetween(readings, start, end, t("2026-10-01T00:30:00Z"))).toBe(30 * 60);
  });
});

describe("deriveChargingStats", () => {
  // Last night's real readings (UTC): plugged in 00:34, scheduled charge
  // from 06:59 to 12:12, unplugged 12:31.
  const start = t("2026-10-01T00:34:54.722Z");
  const end = t("2026-10-01T12:31:09.091Z");
  const states = [
    state(["charging_scheduled", "2026-10-01T01:57:02.944Z"], [39.7, "2026-10-01T02:01:38.478Z"]),
    state(["charging_scheduled", "2026-10-01T05:05:46.334Z"], [39.4, "2026-10-01T05:07:24.915Z"]),
    state(["charging_active", "2026-10-01T06:59:44.969Z"], [39.8, "2026-10-01T07:03:22.198Z"]),
    state(["charging_active", "2026-10-01T06:59:44.969Z"], [60, "2026-10-01T10:35:51.226Z"]),
    state(["charging_complete", "2026-10-01T12:12:43.913Z"], [70, "2026-10-01T12:12:41.947Z"]),
    state(["charging_ready", "2026-10-01T12:31:09.091Z"], [70, "2026-10-01T12:31:17.821Z"]),
  ];

  it("rebuilds charging time and SOC for a watched plug-in", () => {
    expect(deriveChargingStats(states, start, end)).toEqual({
      chargingSeconds: 5 * 3600 + 12 * 60 + 59, // 06:59:44.969 → 12:12:43.913
      startSoc: 39.7,
      endSoc: 70,
    });
  });

  it("doesn't count past the last reading when recording stopped mid-charge", () => {
    const cut = states.slice(0, 4); // last reading 10:35, still charging
    expect(deriveChargingStats(cut, start, end).chargingSeconds).toBe(
      Math.round((t("2026-10-01T10:35:51.226Z") - t("2026-10-01T06:59:44.969Z")) / 1000),
    );
  });

  it("leaves charging time unknown without a reading inside the session", () => {
    expect(deriveChargingStats([], start, end)).toEqual({
      chargingSeconds: null,
      startSoc: null,
      endSoc: null,
    });
    const before = [state(["charging_active", "2026-09-30T10:00:00Z"])];
    expect(deriveChargingStats(before, start, end).chargingSeconds).toBeNull();
  });

  it("lists battery readings inside the session for a SOC curve", () => {
    expect(socReadingsBetween(states, start, end).map((r) => r.soc)).toEqual([39.7, 39.4, 39.8, 60, 70]); // the 12:31:17 reading is after unplug
  });
});
