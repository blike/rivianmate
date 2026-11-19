/**
 * Years of made-up driving and charging for the demo scene
 * (scripts/demo-scene.ts), so History's long periods have something to
 * draw: month bars, a year-spanning axis, seasons in the efficiency. It is
 * rows, not frames: drives with their distances, levels and odometer
 * readings, home charges overnight, and fast charges on road trips.
 *
 * The same inputs give the same history, so screenshots can be retaken.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const KM_PER_MI = 1.609344;
/** Between one drive's end and the next one's start: moving the car about, unrecorded. */
export const MILEAGE_GAP_M = 400;

/** Errands and the places a day goes, around Bloomington–Normal. */
const LOCAL = [
  'Main Street, Normal',
  'Constitution Trail',
  'Veterans Parkway, Bloomington',
  'Uptown Normal',
  'College Avenue, Normal',
  'Downtown Bloomington',
  'Eastland Mall',
  'Ewing Park',
  'Illinois State University',
  'Kroger, Normal',
];
/** Weekends away: a fast charge on the way there and back. */
const AWAY = ['Chicago', 'Springfield', 'St. Louis', 'Champaign', 'Peoria', 'Galena'];

/** The fast-charging stop on the way to a city, by name. */
export const restStop = (city: string) => `Rest stop, ${city} route`;
/** The city a rest stop is on the way to, or null for any other place. */
export const routeOf = (place: string) => place.match(/^Rest stop, (.+) route$/)?.[1] ?? null;

export interface PastDrive {
  startedAt: number;
  endedAt: number;
  km: number;
  startMileageM: number;
  endMileageM: number;
  startBattery: number;
  endBattery: number;
  from: string;
  to: string;
  /** The weather on the day, °C. */
  tempC: number;
  roadTrip: boolean;
}

export interface PastCharge {
  startedAt: number;
  endedAt: number;
  kwh: number;
  startSoc: number;
  endSoc: number;
  powerKw: number;
  /** Overnight at home, else a fast charger on the way. */
  home: boolean;
  /** Where a fast charge was. */
  city: string | null;
}

export interface PastHistoryOptions {
  /** The first day's midnight, and the end: nothing starts at or after it. */
  from: number;
  to: number;
  /** The odometer at delivery, and where the next drive after this history starts. */
  startMileageM: number;
  endMileageM: number;
  capacityKwh: number;
  /** The level the history ends at, ready for what follows. */
  endBattery: number;
  seed?: number;
}

/** Small, fast, seeded: mulberry32. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** 1 in late January, the coldest, to -1 in late July. */
function winter(ts: number): number {
  const d = new Date(ts);
  const dayOfYear = (ts - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY_MS;
  return Math.cos((2 * Math.PI * (dayOfYear - 22)) / 365.25);
}

interface Planned {
  startedAt: number;
  minutesPerKm: number;
  extraMinutes: number;
  km: number;
  from: string;
  to: string;
  roadTrip: boolean;
  /** A fast charge right before this leg. */
  fastChargeBefore: boolean;
}

/**
 * Drives and charges over [from, to): a few drives most days, the odd quiet
 * week, and a weekend away every month or two. Distances are scaled to fit
 * the odometer between the two readings exactly, and the level carries from
 * drive to charge to drive, ending at `endBattery`.
 */
export function pastHistory(opts: PastHistoryOptions): {
  drives: PastDrive[];
  charges: PastCharge[];
} {
  const rnd = random(opts.seed ?? 2023);
  const between = (lo: number, hi: number) => lo + (hi - lo) * rnd();
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
  const days = Math.floor((opts.to - opts.from) / DAY_MS);

  // Which days each drive is on, before distances are fitted.
  const byDay: Planned[][] = [];
  /** Days that end charging for a trip the next morning. */
  const beforeTrip = new Set<number>();
  /** Nights away, charged on arriving rather than at home. */
  const away = new Set<number>();
  let nextTrip = Math.round(between(20, 45));
  let quietWeek = -1;
  for (let d = 0; d < days; d++) {
    const dayStart = opts.from + d * DAY_MS;
    const today: Planned[] = [];
    byDay.push(today);
    const week = Math.floor(d / 7);
    if (d % 7 === 0 && rnd() < 0.06) quietWeek = week;

    if (d >= nextTrip && d + 3 < days) {
      // Out on a Saturday morning, back on Sunday afternoon, a stop each way.
      const destination = pick(AWAY);
      const legKm = between(130, 180);
      const outAt = dayStart + between(8, 10) * HOUR_MS;
      const backAt = dayStart + DAY_MS + between(13, 15.5) * HOUR_MS;
      const leg = (at: number, from: string, to: string, fast: boolean): Planned => ({
        startedAt: at,
        minutesPerKm: 60 / 105,
        extraMinutes: 6,
        km: legKm * between(0.92, 1.08),
        from,
        to,
        roadTrip: true,
        fastChargeBefore: fast,
      });
      // The same stop both ways, halfway along.
      const stop = restStop(destination);
      today.push(leg(outAt, 'Home', stop, false));
      today.push(leg(outAt + (legKm / 105 + 0.75) * HOUR_MS, stop, destination, true));
      // Charged on arriving, for the way back.
      byDay.push([
        leg(backAt, destination, stop, true),
        leg(backAt + (legKm / 105 + 0.75) * HOUR_MS, stop, 'Home', true),
      ]);
      beforeTrip.add(d - 1);
      away.add(d);
      d += 1;
      nextTrip = d + Math.round(between(30, 75));
      continue;
    }

    const weekend = [0, 6].includes(new Date(dayStart).getUTCDay());
    const count =
      week === quietWeek
        ? rnd() < 0.5
          ? 1
          : 0
        : Math.round(weekend ? between(0.6, 4.4) : between(1.6, 5.4));
    let hour = between(6.8, 9.5);
    let at = 'Home';
    for (let i = 0; i < count; i++) {
      const last = i === count - 1;
      const to = last ? 'Home' : pick(LOCAL.filter((p) => p !== at));
      const km = rnd() < 0.08 ? between(35, 80) : 3 + 24 * rnd() ** 1.4;
      today.push({
        startedAt: dayStart + hour * HOUR_MS,
        minutesPerKm: 1.15,
        extraMinutes: 6,
        km,
        from: at,
        to,
        roadTrip: false,
        fastChargeBefore: false,
      });
      at = to;
      hour += Math.max(0.9, (21.5 - hour) / (count - i) + between(-0.6, 0.6));
      if (hour > 21.8) break;
    }
  }
  const planned = byDay.flat();
  const gaps = Math.max(planned.length, 1) * MILEAGE_GAP_M;
  const scale =
    (opts.endMileageM - opts.startMileageM - gaps) /
    1000 /
    planned.reduce((sum, p) => sum + p.km, 0);

  const drives: PastDrive[] = [];
  const charges: PastCharge[] = [];
  let level = 88;
  let mileageM = opts.startMileageM;

  /** Plugged in at home tonight, done by 6:30 tomorrow, wherever that leaves the level. */
  const homeCharge = (dayStart: number, target: number) => {
    if (level >= target - 1) return;
    const lastEnd = drives.at(-1)?.endedAt ?? 0;
    const startedAt = Math.max(lastEnd + HOUR_MS / 2, dayStart + between(21.5, 23) * HOUR_MS);
    const hours = Math.min(
      ((target - level) / 100) * (opts.capacityKwh / 7.4),
      (dayStart + DAY_MS + 6.5 * HOUR_MS - startedAt) / HOUR_MS,
    );
    if (hours <= 0) return;
    const kwh = hours * 7.4;
    const endSoc = level + (kwh / opts.capacityKwh) * 100;
    charges.push({
      startedAt,
      endedAt: startedAt + hours * HOUR_MS,
      kwh,
      startSoc: level,
      endSoc,
      powerKw: 7.4,
      home: true,
      city: null,
    });
    level = endSoc;
  };

  for (let d = 0; d < byDay.length; d++) {
    const today = byDay[d]!;
    const dayStart = opts.from + d * DAY_MS;
    const cold = winter(dayStart + 12 * HOUR_MS);
    const tempC = 11 - 15 * cold + between(-4, 4);
    for (const p of today) {
      // A long drive pushes the next one back rather than overlapping it.
      const prev = drives.at(-1);
      if (prev) p.startedAt = Math.max(p.startedAt, prev.endedAt + 10 * 60_000);
      if (p.fastChargeBefore) {
        const startedAt = drives.at(-1)!.endedAt + between(2, 5) * 60_000;
        const kwh = ((80 - level) / 100) * opts.capacityKwh;
        const powerKw = between(95, 140);
        charges.push({
          startedAt,
          endedAt: startedAt + (kwh / powerKw) * HOUR_MS,
          kwh,
          startSoc: level,
          endSoc: 80,
          powerKw,
          home: false,
          // At the destination, its city; a stop on the way has none to name.
          city: routeOf(p.from) ? null : p.from,
        });
        level = 80;
        p.startedAt = Math.max(p.startedAt, startedAt + (kwh / powerKw) * HOUR_MS + 4 * 60_000);
      }
      const km = p.km * scale;
      // Worse in the cold and at highway speed; a little different every drive.
      const miPerKwh = 2.95 * (1 - 0.15 * cold) * (p.roadTrip ? 0.86 : 1) * between(0.93, 1.07);
      const drop = (km / KM_PER_MI / miPerKwh / opts.capacityKwh) * 100;
      const startBattery = level;
      level -= drop;
      drives.push({
        startedAt: p.startedAt,
        endedAt: p.startedAt + (p.extraMinutes + km * p.minutesPerKm) * 60_000,
        km,
        startMileageM: mileageM,
        endMileageM: mileageM + km * 1000,
        startBattery,
        endBattery: level,
        from: p.from,
        to: p.to,
        tempC,
        roadTrip: p.roadTrip,
      });
      mileageM += km * 1000 + MILEAGE_GAP_M;
    }
    if (away.has(d)) continue;
    if (d === byDay.length - 1) homeCharge(dayStart, opts.endBattery);
    else if (beforeTrip.has(d)) homeCharge(dayStart, 90);
    else if (level < 45 || (level < 62 && rnd() < 0.3)) homeCharge(dayStart, 70);
  }

  return { drives, charges };
}
