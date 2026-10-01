import { describe, expect, it } from "vitest";
import type { ChargeSessionSummary } from "../rivian/types.js";
import { chargerTypeFor, matchSession, summariesForVehicle } from "./charge-history.js";

const summary = (over: Partial<ChargeSessionSummary> = {}): ChargeSessionSummary => ({
  transactionId: "tx-1",
  startInstant: "2026-09-01T10:00:00Z",
  endInstant: "2026-09-01T11:00:00Z",
  totalEnergyKwh: 40,
  rangeAddedKm: 140,
  vendor: null,
  paidTotal: null,
  chargerType: null,
  currencyCode: null,
  city: null,
  vehicleId: "v1",
  isPublic: null,
  isHomeCharger: null,
  ...over,
});
const d = (iso: string) => new Date(iso);

describe("summariesForVehicle", () => {
  it("filters by vehicle id and keeps unlabeled ones only for single-vehicle accounts", () => {
    const list = [summary({ vehicleId: "v1" }), summary({ vehicleId: "v2" }), summary({ vehicleId: null })];
    expect(summariesForVehicle(list, "v1", 1)).toHaveLength(2);
    expect(summariesForVehicle(list, "v1", 2)).toHaveLength(1);
  });
});

describe("matchSession", () => {
  const live = { id: 1, startedAt: d("2026-09-01T10:02:00Z"), endedAt: d("2026-09-01T10:58:00Z"), rivianTransactionId: null };
  const other = { id: 2, startedAt: d("2026-09-02T10:00:00Z"), endedAt: d("2026-09-02T11:00:00Z"), rivianTransactionId: null };

  it("prefers an exact transaction id", () => {
    const linked = { ...other, rivianTransactionId: "tx-1" };
    expect(matchSession(summary(), [live, linked])?.id).toBe(2);
  });

  it("matches a live session whose time overlaps", () => {
    expect(matchSession(summary(), [live, other])?.id).toBe(1);
  });

  it("does not reuse a session already linked to another transaction", () => {
    const taken = { ...live, rivianTransactionId: "tx-other" };
    expect(matchSession(summary(), [taken])).toBeNull();
  });

  it("returns null when nothing overlaps", () => {
    expect(matchSession(summary({ startInstant: "2026-08-01T10:00:00Z", endInstant: "2026-08-01T11:00:00Z" }), [live])).toBeNull();
  });
});

describe("chargerTypeFor", () => {
  it("classifies Rivian network, home and other chargers", () => {
    expect(chargerTypeFor(summary({ vendor: "RIVIAN", isPublic: true }))).toBe("rivian_charger");
    expect(chargerTypeFor(summary({ isHomeCharger: true }))).toBe("wallbox");
    expect(chargerTypeFor(summary({ vendor: "Electrify America", isPublic: true }))).toBe("other");
  });
});
