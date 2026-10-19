/** Patterns across drives and charging sessions, for the History page. */

interface PatternPlace {
  label: string;
  isHome: boolean;
  locationId: number | null;
}

export interface PatternDrive {
  startedAt: string;
  endedAt: string | null;
  distanceKm: number | null;
  energyKwh: number | null;
  start: PatternPlace | null;
  end: PatternPlace | null;
}

export interface PatternSession {
  startedAt: string;
  energyKwh: number | null;
  estimatedEnergyKwh?: number | null;
  /** Spent heating or cooling the pack, where Rivian split the session. */
  thermalKwh?: number | null;
  cost: string | null;
  estimatedCost?: string | null;
  currency: string | null;
  isHome: boolean;
  isPublic?: boolean | null;
  location?: { name: string; isHome: boolean } | null;
}

const within = (iso: string, from: number, to: number) => {
  const t = Date.parse(iso);
  return t >= from && t <= to;
};

/**
 * Drives by the local weekday (Monday first) and hour they started: a 7×24
 * grid of counts, and the distance in each.
 */
export function drivingRhythm(
  drives: readonly PatternDrive[],
  from: number,
  to: number,
): { count: number[][]; km: number[][]; max: number } {
  const count = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  const km = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  let max = 0;
  for (const d of drives) {
    if (!within(d.startedAt, from, to)) continue;
    const t = new Date(d.startedAt);
    const day = (t.getDay() + 6) % 7;
    const hour = t.getHours();
    count[day]![hour]! += 1;
    km[day]![hour]! += d.distanceKm ?? 0;
    max = Math.max(max, count[day]![hour]!);
  }
  return { count, km, max };
}

export interface PlaceVisits {
  label: string;
  isHome: boolean;
  saved: boolean;
  visits: number;
  /** Distance driven on the way there. */
  km: number;
}

/** Where drives ended, most visited first; ties go to the most recent. */
export function topDestinations(
  drives: readonly PatternDrive[],
  from: number,
  to: number,
  limit = 6,
): PlaceVisits[] {
  const places = new Map<string, PlaceVisits & { last: number }>();
  for (const d of drives) {
    if (!d.endedAt || !d.end || !within(d.startedAt, from, to)) continue;
    const key = d.end.label;
    const place = places.get(key) ?? {
      label: d.end.label,
      isHome: d.end.isHome,
      saved: d.end.locationId != null,
      visits: 0,
      km: 0,
      last: 0,
    };
    place.visits += 1;
    place.km += d.distanceKm ?? 0;
    place.last = Math.max(place.last, Date.parse(d.startedAt));
    places.set(key, place);
  }
  return [...places.values()]
    .sort((a, b) => b.visits - a.visits || b.last - a.last)
    .slice(0, limit)
    .map(({ last: _last, ...p }) => p);
}

export interface RouteStats {
  from: string;
  to: string;
  trips: number;
  avgKm: number;
  /** Energy and distance over the trips with an energy figure. */
  energyKwh: number;
  energyKm: number;
}

/**
 * Trips between the same two places, either way round, most taken first.
 * Only routes taken more than once count; a round trip to the same place
 * (start and end alike) is left out.
 */
export function commonRoutes(
  drives: readonly PatternDrive[],
  from: number,
  to: number,
  limit = 4,
): RouteStats[] {
  const routes = new Map<string, RouteStats & { km: number }>();
  for (const d of drives) {
    if (!d.endedAt || !d.start || !d.end || !within(d.startedAt, from, to)) continue;
    if (d.start.label === d.end.label) continue;
    // One route for both directions, named in the direction first seen.
    const key = [d.start.label, d.end.label].sort().join('\u0000');
    const route = routes.get(key) ?? {
      from: d.start.label,
      to: d.end.label,
      trips: 0,
      avgKm: 0,
      km: 0,
      energyKwh: 0,
      energyKm: 0,
    };
    route.trips += 1;
    route.km += d.distanceKm ?? 0;
    if (d.energyKwh != null && d.energyKwh > 0 && d.distanceKm != null && d.distanceKm > 0) {
      route.energyKwh += d.energyKwh;
      route.energyKm += d.distanceKm;
    }
    routes.set(key, route);
  }
  return [...routes.values()]
    .filter((r) => r.trips > 1)
    .sort((a, b) => b.trips - a.trips || b.km - a.km)
    .slice(0, limit)
    .map(({ km, ...r }) => ({ ...r, avgKm: km / r.trips }));
}

export type ChargeSource = 'home' | 'public' | 'other';

export interface EnergyLedger {
  /** Energy charged by where, in kWh. */
  charged: Record<ChargeSource, number>;
  chargedKwh: number;
  /** Of that, what went to heating or cooling the pack, where reported. */
  thermalKwh: number;
  /** Energy drives used, where known, and the distance those covered. */
  usedKwh: number;
  usedKm: number;
  /** Cost by where, recorded or estimated; null where no session had one. */
  cost: Record<ChargeSource, number | null>;
  totalCost: number | null;
  currency: string | null;
  /**
   * When the drives start, if later than the period: charging before then
   * is left out, so both sides cover the same stretch. Null otherwise.
   */
  since: number | null;
}

/** Where a session's energy came from: home, a public network, or anywhere else. */
export function chargeSource(s: PatternSession): ChargeSource {
  if (s.isHome || s.location?.isHome) return 'home';
  if (s.isPublic) return 'public';
  return s.isPublic === false || s.location ? 'other' : 'public';
}

/**
 * What went into the pack over [from, to], from where and at what cost,
 * against what drives used. Charging history imported from Rivian reaches
 * back before the drives do, so the period starts when drives were first
 * recorded (`drivesSince`) when that's later.
 */
export function energyLedger(
  drives: readonly PatternDrive[],
  sessions: readonly PatternSession[],
  from: number,
  to: number,
  drivesSince: number | null,
): EnergyLedger {
  const ledger: EnergyLedger = {
    charged: { home: 0, public: 0, other: 0 },
    chargedKwh: 0,
    thermalKwh: 0,
    usedKwh: 0,
    usedKm: 0,
    cost: { home: null, public: null, other: null },
    totalCost: null,
    currency: null,
    since: null,
  };
  if (drivesSince != null && drivesSince > from) ledger.since = drivesSince;
  const start = ledger.since ?? from;
  for (const s of sessions) {
    if (!within(s.startedAt, start, to)) continue;
    const source = chargeSource(s);
    const kwh = s.energyKwh ?? s.estimatedEnergyKwh ?? 0;
    ledger.charged[source] += kwh;
    ledger.chargedKwh += kwh;
    ledger.thermalKwh += s.thermalKwh ?? 0;
    const raw = s.cost ?? s.estimatedCost ?? null;
    const amount = Number(raw);
    if (raw != null && Number.isFinite(amount)) {
      ledger.cost[source] = (ledger.cost[source] ?? 0) + amount;
      ledger.totalCost = (ledger.totalCost ?? 0) + amount;
      ledger.currency ??= s.currency;
    }
  }
  for (const d of drives) {
    if (!within(d.startedAt, from, to)) continue;
    if (d.energyKwh != null && d.energyKwh > 0 && d.distanceKm != null && d.distanceKm > 0) {
      ledger.usedKwh += d.energyKwh;
      ledger.usedKm += d.distanceKm;
    }
  }
  return ledger;
}

/** The battery over the ledger's period, as the server measured it. */
export interface BatteryWindow {
  capacityKwh: number | null;
  startLevel: number | null;
  endLevel: number | null;
  parkedLossPct: number;
  parkedHours: number;
}

export interface EnergyBalance {
  drivingKwh: number;
  /** Lost while parked and unplugged, measured from the battery level. */
  parkedKwh: number;
  parkedHours: number;
  /** Charging energy spent heating or cooling the pack. */
  thermalKwh: number;
  /** Stored in the battery over the period; negative when it ran down. */
  batteryChangeKwh: number;
  /**
   * Charged but not accounted for by the rest: time plugged in but not
   * charging, sessions without a split, and measurement error. Negative
   * when the rest add up to more than was charged.
   */
  unaccountedKwh: number;
}

/**
 * Where the charged energy went: charged = driving + parked + charging
 * losses + battery change + unaccounted. Null without the battery's levels
 * and capacity.
 */
export function energyBalance(
  ledger: EnergyLedger,
  battery: BatteryWindow | null | undefined,
): EnergyBalance | null {
  const capacity = battery?.capacityKwh;
  if (!battery || capacity == null || battery.startLevel == null || battery.endLevel == null)
    return null;
  const parkedKwh = (battery.parkedLossPct / 100) * capacity;
  const batteryChangeKwh = ((battery.endLevel - battery.startLevel) / 100) * capacity;
  return {
    drivingKwh: ledger.usedKwh,
    parkedKwh,
    parkedHours: battery.parkedHours,
    thermalKwh: ledger.thermalKwh,
    batteryChangeKwh,
    unaccountedKwh:
      ledger.chargedKwh - ledger.usedKwh - parkedKwh - ledger.thermalKwh - batteryChangeKwh,
  };
}
