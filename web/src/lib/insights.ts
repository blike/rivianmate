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

/** A day of the week view: a date of the device's calendar and its reading. */
export interface ParkedDay<T> {
  /** The date in the device's own calendar, as YYYY-MM-DD. */
  key: string;
  /** Local midnight of that date. */
  date: Date;
  /** That day's reading, or null where there was none. */
  window: T | null;
}

/** A date as YYYY-MM-DD, so days sort and key as text. */
function dayKey(day: Date): string {
  const month = `${day.getMonth() + 1}`.padStart(2, '0');
  const date = `${day.getDate()}`.padStart(2, '0');
  return `${day.getFullYear()}-${month}-${date}`;
}

/**
 * The `count` full days before today, oldest first, each with the reading the
 * server gave for it. The server reads its days in this device's zone (the
 * request names it), so its `day` keys are this calendar's dates. A day with
 * no reading keeps its slot, so the days around it don't move. Today is left
 * out: its last reading hasn't come.
 */
export function parkedWeek<R extends { day: string }>(
  records: readonly R[],
  count = 7,
  today = new Date(),
): ParkedDay<R>[] {
  const byDay = new Map(records.map((r) => [r.day, r]));
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - count + i);
    const key = dayKey(date);
    return { key, date, window: byDay.get(key) ?? null };
  });
}
