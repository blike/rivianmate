import type { VehicleInsightsDto } from '@server/api-types';

/** Parked-energy windows worth showing: whole hours, longest first. */
export function parkedWindows<T extends { minutes: number }>(windows: readonly T[]): T[] {
  return windows
    .filter((w) => w.minutes >= 60 && w.minutes % 60 === 0)
    .sort((a, b) => b.minutes - a.minutes);
}

export function windowLabel(minutes: number): string {
  const hours = minutes / 60;
  // A week reads as days, not 168 hours; a day stays "24 hours".
  if (hours > 24 && hours % 24 === 0) return `Last ${hours / 24} days`;
  return `Last ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

export function wifiBand(frequencyMhz: number | null): string | null {
  if (frequencyMhz == null) return null;
  if (frequencyMhz < 3000) return '2.4 GHz';
  if (frequencyMhz < 5925) return '5 GHz';
  return '6 GHz';
}

/** Wi-Fi signal strength in words, from RSSI. */
export function signalLabel(rssiDbm: number | null): string | null {
  if (rssiDbm == null) return null;
  if (rssiDbm >= -60) return 'Strong';
  if (rssiDbm >= -70) return 'Good';
  if (rssiDbm >= -80) return 'Fair';
  return 'Weak';
}

export const PARKED_USES = [
  { key: 'system', label: 'System', color: 'var(--series-1)' },
  { key: 'climate', label: 'Climate', color: 'var(--series-2)' },
  { key: 'gearGuard', label: 'Gear Guard', color: 'var(--series-3)' },
  { key: 'outlets', label: 'Outlets', color: 'var(--series-4)' },
] as const;

/** A window's uses that drew energy, in legend order, for the split bar. */
export function parkedSegments(uses: {
  climate: number;
  system: number;
  gearGuard: number;
  outlets: number;
}) {
  return PARKED_USES.map((u) => ({ ...u, kwh: uses[u.key] })).filter((s) => s.kwh >= 0.05);
}

type ParkedEnergy = NonNullable<VehicleInsightsDto['parkedEnergy']>;

/** One of Rivian's parked-energy windows, as the API hands it over. */
export type ParkedEnergyWindow = ParkedEnergy['windows'][number];

/**
 * What a bar's reading says where there's no split to print: a source that
 * doesn't break the energy down (TeslaMate), or a window whose uses each drew
 * too little to draw.
 */
export function parkedUnsplit(uses: ParkedEnergyWindow['uses']): string {
  return uses == null ? 'Not split by use' : 'No use drew energy';
}

/** A night of the week view: a date of the device's calendar and its window. */
export interface ParkedNight<T extends { minutes: number } = ParkedEnergyWindow> {
  /** The date in the device's own calendar, as YYYY-MM-DD. */
  key: string;
  /** Local midnight of that date. */
  date: Date;
  /** The window that ended on that night, or null where none did. */
  window: T | null;
}

/** An instant's date in the device's calendar, as its own local midnight. */
function localDay(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate());
}

/** A date as YYYY-MM-DD, so days sort and key as text. */
function dayKey(day: Date): string {
  const month = `${day.getMonth() + 1}`.padStart(2, '0');
  const date = `${day.getDate()}`.padStart(2, '0');
  return `${day.getFullYear()}-${month}-${date}`;
}

/**
 * The night an instant belongs to, as its local midnight. A window ends on
 * the night it closes, so an end at local midnight counts for the night that
 * has just run: a millisecond back, not a day, and the calendar does the
 * rest, DST included.
 */
function nightOf(end: number): Date {
  return localDay(new Date(end - 1));
}

/**
 * `count` nights, oldest first, ending with `newest`: every night gets its
 * slot whether it was reported or not, so the nights around a gap don't
 * shift under it.
 */
function week<T extends { minutes: number }>(
  byNight: Map<string, T>,
  newest: Date,
  count: number,
): ParkedNight<T>[] {
  return Array.from({ length: count }, (_, i) => {
    const day = new Date(newest.getFullYear(), newest.getMonth(), newest.getDate() - count + 1 + i);
    const key = dayKey(day);
    return { key, date: day, window: byNight.get(key) ?? null };
  });
}

/**
 * Rivian's parked-energy windows as one bar per night, oldest first over the
 * `count` nights ending with the newest window, in the device's own calendar:
 * the days whoever is reading would call last night and the six before it.
 * A night the source reported nothing for keeps its slot and stays empty, so
 * the nights around it don't shift under it.
 *
 * A window belongs to the night it ends on (see nightOf). Its end is the only
 * timestamp Rivian gives it: the report's own `at`, which every window in a
 * payload shares, or the window's own when a source carries one. Where several
 * windows end on the same night the shortest wins: they nest (a day holds
 * eight hours holds this park), so summing them would count the same energy
 * twice.
 */
export function parkedNights<T extends { minutes: number; at?: string }>(
  windows: readonly T[],
  at: string,
  count = 7,
): ParkedNight<T>[] {
  const reported = Date.parse(at);
  const byNight = new Map<string, T>();
  let newest: Date | null = null;
  for (const window of windows) {
    const own = window.at ? Date.parse(window.at) : Number.NaN;
    const end = Number.isFinite(own) ? own : reported;
    if (!Number.isFinite(end) || !(window.minutes > 0)) continue;
    const day = nightOf(end);
    const key = dayKey(day);
    const kept = byNight.get(key);
    if (!kept || window.minutes < kept.minutes) byNight.set(key, window);
    if (!newest || day.getTime() > newest.getTime()) newest = day;
  }
  if (!newest || count <= 0) return [];
  return week(byNight, newest, count);
}

/**
 * The recorded nights as the week: `count` nights ending today, oldest first,
 * in the device's own calendar. A night with no record keeps its slot, so a
 * night RivianMate was off for stays empty and the days around it don't move.
 *
 * A record is placed by the instant Rivian sent it, so the reader's calendar
 * decides the night whatever zone the recorder wrote its day in. Where two
 * records land on one night (the two calendars disagreeing at a boundary) the
 * latest wins: its 24 hours run closest to now.
 */
export function recordedNights<R extends { at: string; minutes: number }>(
  records: readonly R[],
  count = 7,
  today = new Date(),
): ParkedNight<R>[] {
  const byNight = new Map<string, R>();
  // Today ends the week, so last night without a record stays an empty slot at
  // the end rather than pulling the six before it forward.
  let newest = localDay(today);
  for (const record of records) {
    const at = Date.parse(record.at);
    if (!Number.isFinite(at) || !(record.minutes > 0)) continue;
    const day = nightOf(at);
    const key = dayKey(day);
    const kept = byNight.get(key);
    if (!kept || Date.parse(kept.at) < at) byNight.set(key, record);
    if (day.getTime() > newest.getTime()) newest = day;
  }
  return week(byNight, newest, count);
}
