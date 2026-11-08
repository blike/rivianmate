import type { ChargingSessionDto, DriveDto, TripDetailDto, TripRouteDto } from '@server/api-types';
import { haversineKm } from '../../lib/geo';
import { chargingSecondsNow, formatMoney, sessionCost } from '../../lib/charging';
import { fmt } from '../../lib/state';
import type { UnitFormatter } from '../../lib/units';
import { localKey } from '../../lib/drives';
import { chargeStart } from '../charging/sessions';
import { placeName } from '../drives/format';
import { dayStart, missingBetween, stopNightDates, timelineEntries, sortedByStart } from './trips';

/** Short drives read in whole battery percents: too coarse to compare. */
const MIN_COMPARE_KM = 5;

export const totalClimbM = (drives: readonly DriveDto[]) =>
  drives.reduce((sum, d) => sum + (d.elevationGainM ?? 0), 0);

export const totalDescentM = (drives: readonly DriveDto[]) =>
  drives.reduce((sum, d) => sum + (d.elevationLossM ?? 0), 0);

/** The place farthest from where the journey set out, and how far as the crow flies. */
export function farthestPoint(
  drives: readonly DriveDto[],
): { place: string; km: number; drive: DriveDto } | null {
  const sorted = sortedByStart(drives);
  const first = sorted[0];
  if (first?.startLat == null || first.startLon == null) return null;
  let best: { place: string; km: number; drive: DriveDto } | null = null;
  for (const d of sorted) {
    if (d.endLat == null || d.endLon == null || !d.end) continue;
    const km = haversineKm(first.startLat, first.startLon, d.endLat, d.endLon);
    if (!best || km > best.km) best = { place: placeName(d.end), km, drive: d };
  }
  return best;
}

/** Whether it finished about where it set out. */
export function isRoundTrip(drives: readonly DriveDto[]): boolean {
  const sorted = sortedByStart(drives);
  const first = sorted[0];
  const last = sorted.at(-1);
  if (first?.startLat == null || first.startLon == null) return false;
  if (last?.endLat == null || last.endLon == null) return false;
  return haversineKm(first.startLat, first.startLon, last.endLat, last.endLon) < 1;
}

/**
 * A name to start from: "Trip to Bloomington", by the town farthest out, or
 * the name of a saved place or one navigation went to. A street address
 * alone says too little to name a trip.
 */
export function suggestedName(drives: readonly DriveDto[]): string | null {
  const far = farthestPoint(drives);
  const end = far?.drive.end;
  if (!far || far.km < 1 || !end || end.isHome || end.unnamed) return null;
  if (end.locationId != null || end.navigated) return `Trip to ${end.label}`;
  const town = end.label.includes(',') ? end.label.split(',').at(-1)!.trim() : null;
  return town ? `Trip to ${town}` : null;
}

/** Where the journey slept, a run of nights in one place at a time. */
export interface Stay {
  place: string;
  isHome: boolean;
  /** The first night's evening, YYYY-MM-DD. */
  from: string;
  nights: number;
  /** When it arrived for the first night, and set off after the last. */
  arrivedAt: string;
  leftAt: string;
}

/**
 * Each night of the journey by where it was parked, with nights in a row at
 * the same place as one stay: Jumbo Rocks for 2 nights, then home for 1.
 */
export function tripStays(
  drives: readonly DriveDto[],
  sessions: readonly ChargingSessionDto[],
): Stay[] {
  const stays: Stay[] = [];
  const entries = timelineEntries(drives, sessions);
  entries.forEach((entry, i) => {
    const before = entries[i - 1];
    if (entry.kind !== 'stop' || before?.kind !== 'drive' || !before.drive.end) return;
    const evenings = stopNightDates(entry.startedAt, entry.endedAt);
    if (evenings.length === 0) return;
    const place = placeName(before.drive.end);
    const isHome = before.drive.end.isHome;
    const previous = stays.at(-1);
    // A drive out and back to the same place between nights doesn't split the stay.
    if (previous?.place === place) {
      previous.nights += evenings.length;
      previous.leftAt = entry.endedAt;
    } else {
      stays.push({
        place,
        isHome,
        from: evenings[0]!,
        nights: evenings.length,
        arrivedAt: entry.startedAt,
        leftAt: entry.endedAt,
      });
    }
  });
  return stays;
}

/** A point on the way: where it set out, a stay, or where it finished (or is now). */
export type RoutePoint =
  | { kind: 'start'; place: string; isHome: boolean; at: string }
  | { kind: 'stay'; stay: Stay; kmBefore: number }
  | { kind: 'end'; place: string; isHome: boolean; at: string; kmBefore: number };

/**
 * The journey as its stops: where it set out, each place it spent the night,
 * and where it finished, with the distance driven to reach each. Drives out
 * and back from a stay count toward the stay, not the way between.
 */
export function stayRoute(drives: readonly DriveDto[], stays: readonly Stay[]): RoutePoint[] {
  const sorted = sortedByStart(drives);
  const first = sorted[0];
  const last = sorted.at(-1);
  if (!first?.start || !last?.end) return [];
  // Driven from one time until another, or until the end without one.
  const km = (from: string, to?: string) =>
    sorted
      .filter((d) => d.startedAt >= from && (to == null || d.startedAt < to))
      .reduce((n, d) => n + (d.distanceKm ?? 0), 0);
  const points: RoutePoint[] = [
    {
      kind: 'start',
      place: placeName(first.start),
      isHome: first.start.isHome,
      at: first.startedAt,
    },
  ];
  let since = first.startedAt;
  for (const stay of stays) {
    points.push({ kind: 'stay', stay, kmBefore: km(since, stay.arrivedAt) });
    since = stay.leftAt;
  }
  // Once it's set off after the last night, wherever it got to.
  if (last.startedAt >= since) {
    points.push({
      kind: 'end',
      place: placeName(last.end),
      isHome: last.end.isHome,
      at: last.endedAt ?? last.startedAt,
      kmBefore: km(since),
    });
  }
  return points;
}

/** Places named in a nights summary before the rest are counted as "+6". */
const NAMED_PLACES = 3;

export interface StaysSummary {
  /** Nights away from home. */
  nights: number;
  /** Places slept away from home, a place once however often it came back to. */
  places: number;
  /** The places to name, most nights first, then in the order they came. */
  named: { place: string; nights: number }[];
  /** Places not named. */
  more: number;
  /** Nights spent back home during the trip. */
  homeNights: number;
}

/**
 * Where the trip slept, in short: "10 nights in 9 places", naming the ones it
 * stayed at longest. All of them when there are few; null with none away.
 */
export function staysSummary(stays: readonly Stay[]): StaysSummary | null {
  const byPlace = new Map<string, number>();
  let homeNights = 0;
  for (const s of stays) {
    if (s.isHome) homeNights += s.nights;
    else byPlace.set(s.place, (byPlace.get(s.place) ?? 0) + s.nights);
  }
  if (byPlace.size === 0) return null;
  const places = [...byPlace].map(([place, nights]) => ({ place, nights }));
  // A few are named in order; with more, the longest stays lead (stable for ties).
  const named =
    places.length <= NAMED_PLACES + 1
      ? places
      : [...places].sort((a, b) => b.nights - a.nights).slice(0, NAMED_PLACES);
  return {
    nights: places.reduce((n, p) => n + p.nights, 0),
    places: places.length,
    named,
    more: places.length - named.length,
    homeNights,
  };
}

export interface Fact {
  key: string;
  label: string;
  value: string;
  sub?: string;
}

/** Things worth knowing about the journey; only what the data can back up. */
export function tripFacts(
  trip: TripDetailDto,
  routes: readonly TripRouteDto[],
  u: UnitFormatter,
): Fact[] {
  const facts: Fact[] = [];
  const { stats, drives, sessions } = trip;

  const altitudes = routes.flatMap((r) => r.profile.map((p) => p.altitudeM));
  if (altitudes.length > 1) {
    // A long trip's profile is too many points to spread into Math.min.
    const lowest = altitudes.reduce((a, b) => Math.min(a, b));
    const highest = altitudes.reduce((a, b) => Math.max(a, b));
    facts.push({
      key: 'elevation',
      label: 'Elevation',
      value: `${u.formatElevation(lowest)} – ${u.formatElevation(highest)}`,
    });
  }

  const climb = totalClimbM(drives);
  const descent = totalDescentM(drives);
  if (climb >= 100 || descent >= 100) {
    facts.push({
      key: 'climb',
      label: 'Climb / descent',
      value: `↑ ${u.formatElevation(climb)}`,
      sub: `↓ ${u.formatElevation(descent)}`,
    });
  }

  const usable = drives.filter((d) => d.distanceKm != null && d.distanceKm >= MIN_COMPARE_KM);
  const longest = usable.reduce<DriveDto | null>(
    (best, d) => (!best || d.distanceKm! > best.distanceKm! ? d : best),
    null,
  );
  if (longest && drives.length > 1) {
    facts.push({
      key: 'longest',
      label: 'Longest drive',
      value: u.formatDistance(longest.distanceKm),
    });
  }

  const fastest = sessions.reduce<ChargingSessionDto | null>(
    (best, s) => (s.maxPowerKw != null && (!best || s.maxPowerKw > best.maxPowerKw!) ? s : best),
    null,
  );
  if (fastest) {
    facts.push({
      key: 'peak',
      label: 'Fastest charge',
      value: `${fmt(fastest.maxPowerKw, 0)} kW`,
    });
  }

  // The lowest the battery was left by a drive, and where.
  const lowest = drives.reduce<DriveDto | null>(
    (best, d) => (d.endBattery != null && (!best || d.endBattery < best.endBattery!) ? d : best),
    null,
  );
  if (lowest) {
    facts.push({
      key: 'low',
      label: 'Lowest battery',
      value: `${fmt(lowest.endBattery, 0)}%`,
      sub: lowest.end ? `Arriving at ${placeName(lowest.end)}` : undefined,
    });
  }

  const [cost] = stats.costs;
  if (
    stats.costs.length === 1 &&
    cost &&
    stats.distanceKm > 0 &&
    stats.chargesWithCost === stats.charges
  ) {
    const perUnit = cost.amount / (u.distance(stats.distanceKm) ?? 1);
    facts.push({
      key: 'perDistance',
      label: `Cost per ${u.distanceUnit}`,
      value: `${cost.estimated ? '≈ ' : ''}${formatMoney(String(perUnit), cost.currency)}`,
    });
  }

  return facts;
}

/**
 * The battery picking up this many points from where it was left, with
 * nothing in the trip between, is a change it has no record of: a charge or
 * drive taken out, or a long stop's drain. Less is rounding and settling.
 */
const UNREAD_SOC = 2;

export interface RoadPoint {
  /** Distance driven so far, by the odometer. */
  km: number;
  /** Null where there's no route to read the ground from. */
  elevationM: number | null;
  battery: number | null;
}

export interface RoadProfile {
  points: RoadPoint[];
  /** Where each day's driving began along the way. */
  days: { key: string; km: number }[];
  hasElevation: boolean;
  /** How far was driven with no route to read the ground from: a gap in the elevation. */
  unmappedKm: number;
  /** As the crow flies, across driving that isn't in the trip. */
  missingKm: number;
}

/**
 * The journey laid out by distance driven: the ground and the battery along
 * it, each drive as long as its odometer says, so the whole matches the trip's
 * total. A drive without a route leaves a gap in the ground while the battery
 * still runs from its start to its end. A charge rises where it was parked.
 * Where one drive doesn't meet the next, the driving between isn't in the
 * trip: it takes up its straight-line distance with nothing read across it, so
 * the lines are bridged, not joined by a cliff, and the axis runs that much
 * past the trip's total. Where the battery picks up at another level than it
 * was left, with no charge in the trip to say how, that's bridged too.
 */
export function roadProfile(
  drives: readonly DriveDto[],
  sessions: readonly ChargingSessionDto[],
  routes: readonly TripRouteDto[],
): RoadProfile {
  const byId = new Map(routes.map((r) => [r.driveId, r.profile]));
  const charges = sessions
    .filter((s) => s.startSoc != null && s.endSoc != null)
    .sort((a, b) => Date.parse(chargeStart(a)) - Date.parse(chargeStart(b)));
  const points: RoadPoint[] = [];
  const days: RoadProfile['days'] = [];
  let km = 0;
  let unmappedKm = 0;
  let missingKm = 0;
  let next = 0;
  // Picking up at another level than it was left: a point with nothing read,
  // so the change is bridged dashed, not drawn as a jump that happened.
  const resumeAt = (battery: number | null) => {
    const last = points.at(-1);
    if (last?.battery == null || battery == null) return;
    if (Math.abs(battery - last.battery) < UNREAD_SOC) return;
    points.push({ km, elevationM: last.elevationM, battery: null });
  };
  const chargeUntil = (at: number) => {
    for (; next < charges.length && Date.parse(chargeStart(charges[next]!)) < at; next++) {
      const s = charges[next]!;
      resumeAt(s.startSoc);
      points.push(
        { km, elevationM: null, battery: s.startSoc },
        { km, elevationM: null, battery: s.endSoc },
      );
    }
  };
  let before: DriveDto | undefined;
  for (const d of sortedByStart(drives)) {
    // Ahead of any charges in it, which rise where it picks up again.
    if (before && missingBetween(before, d)) {
      const gapKm = haversineKm(before.endLat!, before.endLon!, d.startLat!, d.startLon!);
      // One point with nothing read, so each line stops and is bridged across.
      points.push({ km: km + gapKm / 2, elevationM: null, battery: null });
      km += gapKm;
      missingKm += gapKm;
    }
    before = d;
    chargeUntil(Date.parse(d.startedAt));
    resumeAt(d.startBattery);
    const day = localKey(new Date(d.startedAt));
    if (days.at(-1)?.key !== day) days.push({ key: day, km });
    const profile = byId.get(d.id) ?? [];
    const routeKm = profile.at(-1)?.km ?? 0;
    const span = d.distanceKm ?? routeKm;
    // Along the drive the battery is taken to fall evenly.
    const batteryAt = (share: number) =>
      d.startBattery != null && d.endBattery != null
        ? d.startBattery + (d.endBattery - d.startBattery) * share
        : null;
    if (profile.length >= 2 && routeKm > 0) {
      for (const p of profile) {
        const share = p.km / routeKm;
        points.push({ km: km + span * share, elevationM: p.altitudeM, battery: batteryAt(share) });
      }
    } else {
      points.push(
        { km, elevationM: null, battery: d.startBattery },
        { km: km + span, elevationM: null, battery: d.endBattery },
      );
      unmappedKm += span;
    }
    km += span;
  }
  chargeUntil(Infinity);
  return {
    points,
    days,
    hasElevation: points.some((p) => p.elevationM != null),
    unmappedKm,
    missingKm,
  };
}

/**
 * A straight line across each gap in a series, from the last value before it
 * to the first after, and nothing elsewhere: drawn dashed, it bridges what
 * wasn't read without passing it off as a reading. A gap at either end stays open.
 */
export function bridgeGaps(xs: readonly number[], values: readonly (number | null)[]) {
  const out: (number | null)[] = values.map(() => null);
  let last = -1;
  values.forEach((v, i) => {
    if (v == null) return;
    if (last >= 0 && i > last + 1) {
      for (let j = last; j <= i; j++) {
        const span = xs[i]! - xs[last]!;
        const share = span > 0 ? (xs[j]! - xs[last]!) / span : 0;
        out[j] = values[last]! + (v - values[last]!) * share;
      }
    }
    last = i;
  });
  return out;
}

export interface DriverShare {
  /** Null for drives with no driver recorded. */
  name: string | null;
  distanceKm: number;
  seconds: number;
  drives: number;
}

/** Who drove how much, the most first and unknown last; empty when no driver is known. */
export function driverSplit(drives: readonly DriveDto[]): DriverShare[] {
  if (!drives.some((d) => d.driver)) return [];
  const byName = new Map<string | null, DriverShare>();
  for (const d of drives) {
    const name = d.driver?.name ?? null;
    const share = byName.get(name) ?? { name, distanceKm: 0, seconds: 0, drives: 0 };
    share.distanceKm += d.distanceKm ?? 0;
    share.seconds += d.endedAt
      ? Math.max(0, Date.parse(d.endedAt) - Date.parse(d.startedAt)) / 1000
      : 0;
    share.drives++;
    byName.set(name, share);
  }
  return [...byName.values()].sort(
    (a, b) => Number(a.name == null) - Number(b.name == null) || b.distanceKm - a.distanceKm,
  );
}

export interface TimeSplit {
  drivingS: number;
  chargingS: number;
  /** Between drives that don't meet: driving the trip has no record of. */
  missingS: number;
  parkedS: number;
  totalS: number;
}

/** How the time away was spent; parked is whatever's left. */
export function timeSplit(trip: TripDetailDto): TimeSplit | null {
  const { stats } = trip;
  if (!stats.startedAt || !stats.endedAt) return null;
  const totalS = (Date.parse(stats.endedAt) - Date.parse(stats.startedAt)) / 1000;
  if (totalS <= 0) return null;
  const drivingS = stats.drivingSeconds;
  const chargingS = stats.chargingSeconds;
  // A charge in a break counts as charging already, so it's not missing too.
  let missingS = 0;
  for (const e of timelineEntries(trip.drives, trip.sessions)) {
    if (e.kind !== 'missing') continue;
    const from = Date.parse(e.startedAt);
    const to = Date.parse(e.endedAt);
    const charged = trip.sessions
      .filter((s) => Date.parse(chargeStart(s)) >= from && Date.parse(chargeStart(s)) < to)
      .reduce((sum, s) => sum + (s.chargingSeconds ?? 0), 0);
    missingS += Math.max(0, (to - from) / 1000 - charged);
  }
  return {
    drivingS,
    chargingS,
    missingS,
    parkedS: Math.max(0, totalS - drivingS - chargingS - missingS),
    totalS,
  };
}

export interface DaySummary {
  key: string;
  /** Noon that day, for formatting without zone surprises. */
  at: number;
  distanceKm: number;
  drives: DriveDto[];
  sessions: ChargingSessionDto[];
  energyUsedKwh: number;
  energyAddedKwh: number;
  chargingS: number;
  cost: string | null;
  from: string | null;
  to: string | null;
  weather: DriveDto['weather'];
  tempC: number | null;
}

/** Each day of the journey, oldest first. */
export function daySummaries(
  drives: readonly DriveDto[],
  sessions: readonly ChargingSessionDto[],
): DaySummary[] {
  // A charge on the day it charged, as everywhere else in the trip.
  const keys = [
    ...new Set([...drives.map((d) => d.startedAt), ...sessions.map(chargeStart)].map(localKey)),
  ].sort();
  return keys.map((key) => {
    const dayDrives = sortedByStart(drives.filter((d) => localKey(d.startedAt) === key));
    const daySessions = sessions.filter((s) => localKey(chargeStart(s)) === key);
    const costs = daySessions.flatMap((s) => {
      const c = sessionCost(s);
      return c ? [{ ...c, currency: s.currency }] : [];
    });
    const sameCurrency = new Set(costs.map((c) => c.currency ?? '')).size === 1;
    const longest = dayDrives.reduce<DriveDto | null>(
      (best, d) =>
        d.weather && (!best || (d.distanceKm ?? 0) > (best.distanceKm ?? 0)) ? d : best,
      null,
    );
    return {
      key,
      at: dayStart(key).getTime(),
      distanceKm: dayDrives.reduce((sum, d) => sum + (d.distanceKm ?? 0), 0),
      drives: dayDrives,
      sessions: daySessions,
      energyUsedKwh: dayDrives.reduce((sum, d) => sum + (d.energyKwh ?? 0), 0),
      energyAddedKwh: daySessions.reduce(
        (sum, s) => sum + (s.energyKwh ?? s.estimatedEnergyKwh ?? 0),
        0,
      ),
      chargingS: daySessions.reduce((sum, s) => sum + (chargingSecondsNow(s) ?? 0), 0),
      cost:
        costs.length > 0 && sameCurrency
          ? `${costs.some((c) => c.estimated) ? '≈ ' : ''}${formatMoney(
              String(costs.reduce((sum, c) => sum + c.amount, 0)),
              costs[0]!.currency,
            )}`
          : null,
      from: dayDrives[0]?.start ? placeName(dayDrives[0].start) : null,
      to: dayDrives.at(-1)?.end ? placeName(dayDrives.at(-1)!.end!) : null,
      weather: longest?.weather ?? null,
      tempC: longest?.outsideTempC ?? null,
    };
  });
}
