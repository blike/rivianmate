import { describe, expect, it } from "vitest";
import { chargeOutlook, chargingSecondsNow, socRange } from "./charging.js";
import { fmtSeconds } from "./state.js";

describe("chargingSecondsNow", () => {
  const now = Date.parse("2026-10-01T12:00:00Z");

  it("adds a running stretch to finished ones", () => {
    expect(chargingSecondsNow({ chargingSeconds: 600, chargingSince: "2026-10-01T11:30:00Z" }, now)).toBe(600 + 1800);
    expect(chargingSecondsNow({ chargingSeconds: 18779, chargingSince: null }, now)).toBe(18779);
  });

  it("is unknown for sessions RivianMate didn't watch", () => {
    expect(chargingSecondsNow({ chargingSeconds: null, chargingSince: null }, now)).toBeNull();
  });
});

describe("socRange", () => {
  it("shows start → end, marking a missing side", () => {
    expect(socRange(39.7, 70)).toBe("40→70%");
    expect(socRange(39.7, null)).toBe("40→?%");
    expect(socRange(null, null)).toBe("—");
  });
});

describe("fmtSeconds", () => {
  it("formats minutes and hours", () => {
    expect(fmtSeconds(45 * 60)).toBe("45m");
    expect(fmtSeconds(18779)).toBe("5h 13m");
  });
});

describe("chargeOutlook", () => {
  // A real charge: a schedule ending at 12:59 UTC stopped it near 90%, short of a 95% limit.
  const base = { limit: 95, powerKw: 7.4, capacityKwh: 111.5 };

  it("flags a session that ends before the limit, with the SoC it reaches", () => {
    const o = chargeOutlook({ ...base, soc: 84.6, minutesLeft: 56 });
    expect(o.kind).toBe("session");
    expect(o.minutes).toBe(56);
    expect(o.endSoc).toBeCloseTo(90.8, 1);
  });

  it("is time to limit when the session gets there", () => {
    expect(chargeOutlook({ ...base, soc: 90, minutesLeft: 60 })).toMatchObject({ kind: "limit", minutes: 60, endSoc: 95 });
  });

  it("estimates time to limit when Rivian gives no time", () => {
    const o = chargeOutlook({ ...base, soc: 85, minutesLeft: null });
    expect(o.kind).toBe("limit");
    expect(o.minutes).toBeCloseTo(10 / ((7.4 / 111.5) * 100 / 60), 5);
  });

  it("trusts Rivian's time when power or pack size is unknown", () => {
    expect(chargeOutlook({ ...base, powerKw: null, soc: 50, minutesLeft: 30 })).toMatchObject({ kind: "limit", minutes: 30 });
  });
});
