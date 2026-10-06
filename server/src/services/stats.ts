/** Pure aggregations behind the Stats page. */
import { dayFormatter } from "./health.js";

/** Peak power at or above this is a DC fast charge; onboard AC tops out near 11.5 kW. */
export const DC_MIN_KW = 20;

export type ChargeKind = "ac" | "dc" | "unknown";

export interface StatSession {
  startedAt: Date;
  endedAt: Date | null;
  energyKwh: number | null;
  maxPowerKw: number | null;
  avgPowerKw: number | null;
  chargingSeconds: number | null;
  chargerType: string | null;
  vendor: string | null;
  isHome: boolean;
  /** Recorded, entered or estimated cost, as a number. */
  cost: number | null;
  currency: string | null;
}

/**
 * AC or DC, from the power RivianMate recorded, else the session's average
 * rate (energy over time plugged in). Home sessions are AC. Sessions
 * imported from Rivian carry no power, so the average is all there is.
 */
export function chargeKind(s: StatSession): ChargeKind {
  if (s.maxPowerKw != null && s.maxPowerKw > 0) return s.maxPowerKw >= DC_MIN_KW ? "dc" : "ac";
  if (s.avgPowerKw != null && s.avgPowerKw > 0) return s.avgPowerKw >= DC_MIN_KW ? "dc" : "ac";
  if (s.isHome) return "ac";
  const seconds =
    s.chargingSeconds != null && s.chargingSeconds > 0
      ? s.chargingSeconds
      : s.endedAt
        ? (s.endedAt.getTime() - s.startedAt.getTime()) / 1000
        : null;
  if (s.energyKwh == null || !(s.energyKwh > 0) || seconds == null || !(seconds > 0)) return "unknown";
  return s.energyKwh / (seconds / 3600) >= DC_MIN_KW ? "dc" : "ac";
}

/** Where a session charged: Home, a named network, or Other. */
export function chargingNetwork(s: Pick<StatSession, "isHome" | "chargerType" | "vendor">): string {
  if (s.isHome) return "Home";
  if (s.chargerType === "rivian_charger") return "Rivian Adventure Network";
  const vendor = s.vendor?.trim();
  if (!vendor) return "Other";
  if (/tesla/i.test(vendor)) return "Tesla Supercharger";
  if (/rivian/i.test(vendor)) return "Rivian";
  if (/electrify\s*america/i.test(vendor)) return "Electrify America";
  if (/chargepoint/i.test(vendor)) return "ChargePoint";
  if (/evgo/i.test(vendor)) return "EVgo";
  // All-caps vendor names read better in title case; mixed case is kept.
  return vendor === vendor.toUpperCase()
    ? vendor.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
    : vendor;
}

export interface MoneyTotal {
  currency: string;
  amount: number;
}

function addMoney(totals: Map<string, number>, amount: number | null, currency: string | null) {
  if (amount == null || !Number.isFinite(amount)) return;
  const key = currency ?? "USD";
  totals.set(key, (totals.get(key) ?? 0) + amount);
}

function moneyList(totals: Map<string, number>): MoneyTotal[] {
  return [...totals.entries()]
    .map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 }))
    .sort((a, b) => b.amount - a.amount);
}

export interface ChargingSummary {
  sessions: number;
  energyKwh: number;
  cost: MoneyTotal[];
  homeKwh: number;
  awayKwh: number;
  acSessions: number;
  dcSessions: number;
  /** Energy per local day the session started, split by AC and DC. */
  days: { day: string; acKwh: number; dcKwh: number; unknownKwh: number }[];
  networks: { name: string; sessions: number; energyKwh: number; cost: MoneyTotal[] }[];
  /**
   * Average price paid per kWh over sessions with a cost, in the most-used
   * currency; null without any.
   */
  pricePerKwh: { currency: string; amount: number } | null;
}

export function chargingSummary(sessions: readonly StatSession[], timeZone = "UTC"): ChargingSummary {
  const dayOf = dayFormatter(timeZone);
  const cost = new Map<string, number>();
  const days = new Map<string, { acKwh: number; dcKwh: number; unknownKwh: number }>();
  const networks = new Map<string, { sessions: number; energyKwh: number; cost: Map<string, number> }>();
  const priced = new Map<string, { cost: number; kwh: number }>();
  let energyKwh = 0;
  let homeKwh = 0;
  let awayKwh = 0;
  let acSessions = 0;
  let dcSessions = 0;

  for (const s of sessions) {
    const kwh = s.energyKwh != null && s.energyKwh > 0 ? s.energyKwh : 0;
    const kind = chargeKind(s);
    energyKwh += kwh;
    if (s.isHome) homeKwh += kwh;
    else awayKwh += kwh;
    if (kind === "ac") acSessions += 1;
    if (kind === "dc") dcSessions += 1;
    addMoney(cost, s.cost, s.currency);

    const day = dayOf(s.startedAt);
    const d = days.get(day) ?? { acKwh: 0, dcKwh: 0, unknownKwh: 0 };
    if (kind === "ac") d.acKwh += kwh;
    else if (kind === "dc") d.dcKwh += kwh;
    else d.unknownKwh += kwh;
    days.set(day, d);

    const name = chargingNetwork(s);
    const n = networks.get(name) ?? { sessions: 0, energyKwh: 0, cost: new Map() };
    n.sessions += 1;
    n.energyKwh += kwh;
    addMoney(n.cost, s.cost, s.currency);
    networks.set(name, n);

    if (s.cost != null && kwh > 0) {
      const key = s.currency ?? "USD";
      const p = priced.get(key) ?? { cost: 0, kwh: 0 };
      p.cost += s.cost;
      p.kwh += kwh;
      priced.set(key, p);
    }
  }

  let pricePerKwh: ChargingSummary["pricePerKwh"] = null;
  for (const [currency, p] of priced) {
    if (p.kwh > 0 && (!pricePerKwh || p.kwh > (priced.get(pricePerKwh.currency)?.kwh ?? 0))) {
      pricePerKwh = { currency, amount: p.cost / p.kwh };
    }
  }

  return {
    sessions: sessions.length,
    energyKwh,
    cost: moneyList(cost),
    homeKwh,
    awayKwh,
    acSessions,
    dcSessions,
    days: [...days.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, d]) => ({ day, ...d })),
    networks: [...networks.entries()]
      .map(([name, n]) => ({ name, sessions: n.sessions, energyKwh: n.energyKwh, cost: moneyList(n.cost) }))
      .sort((a, b) => b.energyKwh - a.energyKwh || b.sessions - a.sessions),
    pricePerKwh,
  };
}

export interface StatDrive {
  id: number;
  startedAt: Date;
  endedAt: Date | null;
  distanceKm: number | null;
  energyKwh: number | null;
  maxSpeedKmh: number | null;
}

export interface DriveTotals {
  drives: number;
  distanceKm: number;
  /** Energy over drives where it's known. */
  energyKwh: number;
  /** Distance of the drives whose energy is known, to pair with energyKwh. */
  energyDistanceKm: number;
  drivingSeconds: number;
  longest: { id: number; startedAt: string; distanceKm: number } | null;
  topSpeedKmh: number | null;
}

/** Totals over completed drives. */
export function driveTotals(drives: readonly StatDrive[]): DriveTotals {
  let distanceKm = 0;
  let energyKwh = 0;
  let energyDistanceKm = 0;
  let drivingSeconds = 0;
  let longest: DriveTotals["longest"] = null;
  let topSpeedKmh: number | null = null;
  let count = 0;
  for (const d of drives) {
    if (!d.endedAt) continue;
    count += 1;
    const km = d.distanceKm != null && d.distanceKm > 0 ? d.distanceKm : 0;
    distanceKm += km;
    drivingSeconds += Math.max(0, (d.endedAt.getTime() - d.startedAt.getTime()) / 1000);
    if (d.energyKwh != null && d.energyKwh > 0 && km > 0) {
      energyKwh += d.energyKwh;
      energyDistanceKm += km;
    }
    if (km > 0 && (!longest || km > longest.distanceKm)) {
      longest = { id: d.id, startedAt: d.startedAt.toISOString(), distanceKm: km };
    }
    if (d.maxSpeedKmh != null && (topSpeedKmh == null || d.maxSpeedKmh > topSpeedKmh)) {
      topSpeedKmh = d.maxSpeedKmh;
    }
  }
  return { drives: count, distanceKm, energyKwh, energyDistanceKm, drivingSeconds, longest, topSpeedKmh };
}

/**
 * One session's curve reduced to its average power per whole percent of
 * SoC, so long sessions don't outweigh short ones on a shared chart.
 */
export function powerBySoc(
  points: readonly { soc: number | null; powerKw: number | null }[],
): { soc: number; powerKw: number }[] {
  const bins = new Map<number, { sum: number; n: number }>();
  for (const p of points) {
    if (p.soc == null || p.powerKw == null || !(p.powerKw > 0) || p.soc < 0 || p.soc > 100) continue;
    const soc = Math.round(p.soc);
    const bin = bins.get(soc) ?? { sum: 0, n: 0 };
    bin.sum += p.powerKw;
    bin.n += 1;
    bins.set(soc, bin);
  }
  return [...bins.entries()]
    .sort(([a], [b]) => a - b)
    .map(([soc, { sum, n }]) => ({ soc, powerKw: sum / n }));
}
