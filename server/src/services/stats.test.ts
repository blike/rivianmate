import { describe, expect, it } from "vitest";
import {
  type StatSession,
  chargeKind,
  chargingNetwork,
  chargingSummary,
  driveTotals,
  powerBySoc,
} from "./stats.js";

const at = (h: number) => new Date(Date.UTC(2026, 8, 1, 12) + h * 3600_000);

const session = (over: Partial<StatSession>): StatSession => ({
  startedAt: at(0),
  endedAt: at(1),
  energyKwh: 10,
  maxPowerKw: null,
  avgPowerKw: null,
  chargingSeconds: null,
  chargerType: "other",
  vendor: null,
  isHome: false,
  cost: null,
  currency: null,
  ...over,
});

describe("chargeKind", () => {
  it("uses recorded peak power first", () => {
    expect(chargeKind(session({ maxPowerKw: 180 }))).toBe("dc");
    expect(chargeKind(session({ maxPowerKw: 11.5 }))).toBe("ac");
  });

  it("falls back to average power, then energy over time", () => {
    expect(chargeKind(session({ avgPowerKw: 60 }))).toBe("dc");
    // 40 kWh in 40 minutes = 60 kW.
    expect(chargeKind(session({ energyKwh: 40, endedAt: at(40 / 60) }))).toBe("dc");
    // 40 kWh in 8 hours = 5 kW.
    expect(chargeKind(session({ energyKwh: 40, endedAt: at(8) }))).toBe("ac");
    expect(chargeKind(session({ energyKwh: 40, chargingSeconds: 1800, endedAt: at(8) }))).toBe("dc");
  });

  it("treats home as AC and is unknown without evidence", () => {
    expect(chargeKind(session({ isHome: true, energyKwh: null }))).toBe("ac");
    expect(chargeKind(session({ energyKwh: null }))).toBe("unknown");
    expect(chargeKind(session({ endedAt: null }))).toBe("unknown");
  });
});

describe("chargingNetwork", () => {
  it("names home, Rivian and common networks", () => {
    expect(chargingNetwork({ isHome: true, chargerType: "wallbox", vendor: null })).toBe("Home");
    expect(chargingNetwork({ isHome: false, chargerType: "rivian_charger", vendor: "RIVIAN" })).toBe(
      "Rivian Adventure Network",
    );
    expect(chargingNetwork({ isHome: false, chargerType: "other", vendor: "Tesla Inc" })).toBe("Tesla Supercharger");
    expect(chargingNetwork({ isHome: false, chargerType: "other", vendor: "ELECTRIFY AMERICA" })).toBe(
      "Electrify America",
    );
    expect(chargingNetwork({ isHome: false, chargerType: "other", vendor: "SHELL RECHARGE" })).toBe("Shell Recharge");
    expect(chargingNetwork({ isHome: false, chargerType: "other", vendor: "Blink" })).toBe("Blink");
    expect(chargingNetwork({ isHome: false, chargerType: "other", vendor: " " })).toBe("Other");
  });
});

describe("chargingSummary", () => {
  const sessions = [
    session({ isHome: true, chargerType: "wallbox", energyKwh: 40, endedAt: at(8), cost: 6, currency: "USD" }),
    session({ startedAt: at(24), endedAt: at(24.5), energyKwh: 50, maxPowerKw: 200, chargerType: "rivian_charger", cost: 20, currency: "USD" }),
    session({ startedAt: at(25), energyKwh: null }),
  ];
  const r = chargingSummary(sessions);

  it("totals energy, cost and where it was charged", () => {
    expect(r.sessions).toBe(3);
    expect(r.energyKwh).toBe(90);
    expect(r.homeKwh).toBe(40);
    expect(r.awayKwh).toBe(50);
    expect(r.cost).toEqual([{ currency: "USD", amount: 26 }]);
    expect(r.acSessions).toBe(1);
    expect(r.dcSessions).toBe(1);
  });

  it("splits each day's energy by AC and DC", () => {
    expect(r.days).toEqual([
      { day: "2026-09-01", acKwh: 40, dcKwh: 0, unknownKwh: 0 },
      { day: "2026-09-02", acKwh: 0, dcKwh: 50, unknownKwh: 0 },
    ]);
  });

  it("groups by network, most energy first", () => {
    expect(r.networks.map((n) => [n.name, n.sessions, n.energyKwh])).toEqual([
      ["Rivian Adventure Network", 1, 50],
      ["Home", 1, 40],
      ["Other", 1, 0],
    ]);
  });

  it("averages the price over priced energy only", () => {
    expect(r.pricePerKwh?.currency).toBe("USD");
    expect(r.pricePerKwh?.amount).toBeCloseTo(26 / 90);
  });

  it("uses local days", () => {
    // 12:00 UTC on Sep 1 is still Sep 1 in Tokyo's evening; 23:00 UTC isn't.
    const late = chargingSummary([session({ startedAt: new Date(Date.UTC(2026, 8, 1, 23)) })], "Asia/Tokyo");
    expect(late.days[0]!.day).toBe("2026-09-02");
  });

  it("is empty without sessions", () => {
    const empty = chargingSummary([]);
    expect(empty).toMatchObject({ sessions: 0, energyKwh: 0, days: [], networks: [], pricePerKwh: null });
  });
});

describe("driveTotals", () => {
  it("totals completed drives and pairs energy with its distance", () => {
    const r = driveTotals([
      { id: 1, startedAt: at(0), endedAt: at(1), distanceKm: 80, energyKwh: 16, maxSpeedKmh: 110 },
      { id: 2, startedAt: at(2), endedAt: at(2.5), distanceKm: 20, energyKwh: null, maxSpeedKmh: 70 },
      { id: 3, startedAt: at(3), endedAt: null, distanceKm: 500, energyKwh: 99, maxSpeedKmh: 150 },
    ]);
    expect(r.drives).toBe(2);
    expect(r.distanceKm).toBe(100);
    expect(r.energyKwh).toBe(16);
    expect(r.energyDistanceKm).toBe(80);
    expect(r.drivingSeconds).toBe(5400);
    expect(r.longest).toEqual({ id: 1, startedAt: at(0).toISOString(), distanceKm: 80 });
    expect(r.topSpeedKmh).toBe(110);
  });
});

describe("powerBySoc", () => {
  it("averages power per whole percent and skips gaps", () => {
    expect(
      powerBySoc([
        { soc: 20.2, powerKw: 200 },
        { soc: 19.8, powerKw: 180 },
        { soc: 21, powerKw: 0 },
        { soc: 22, powerKw: null },
        { soc: 30, powerKw: 150 },
      ]),
    ).toEqual([
      { soc: 20, powerKw: 190 },
      { soc: 30, powerKw: 150 },
    ]);
  });
});
