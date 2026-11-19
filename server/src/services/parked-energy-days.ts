import type { ParkedDayDto } from '../api-types.js';
import {
  type ParkedEnergyWindow,
  RVM_PARKED_ENERGY,
  decodeParkedEnergy,
} from '../rivian/parallax/index.js';
import type { ArchivedMessage, ParallaxArchive } from './parallax-archive.js';

/** The window a day is read from: Rivian's rolling 24 hours. */
const DAY_MINUTES = 24 * 60;
const DAY_MS = 86_400_000;

/**
 * The window a day's numbers come from: the shortest of those at least a day
 * long, so the rolling 24 hours beats a park that has run for days, and a
 * payload carrying only shorter windows gives nothing rather than
 * understating a day with its last 8 hours.
 */
export function dayWindow(windows: readonly ParkedEnergyWindow[]): ParkedEnergyWindow | null {
  return windows.reduce<ParkedEnergyWindow | null>(
    (kept, w) => (w.minutes >= DAY_MINUTES && (!kept || w.minutes < kept.minutes) ? w : kept),
    null,
  );
}

/** YYYY-MM-DD of an instant in `zone`. en-CA formats that way. */
function dateIn(zone: string): (at: number) => string {
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return (at) => format.format(at);
}

/** A YYYY-MM-DD date `n` days before another, by the calendar alone. */
function daysBefore(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
}

/**
 * The `days` full days before today in `zone`, oldest first, each with the
 * last 24-hour window Rivian reported that day: the day just run, plus the
 * night before it. Today is left out because its last reading hasn't come.
 * A day without a reading is left out too; the chart keeps its slot.
 *
 * A reading at exactly local midnight closes the day before it, so a
 * millisecond is taken off before the date is read.
 */
export function parkedDays(
  messages: readonly ArchivedMessage[],
  days: number,
  zone: string,
  now: Date,
): ParkedDayDto[] {
  const dateOf = dateIn(zone);
  const today = dateOf(now.getTime());
  const wanted = new Set(Array.from({ length: days }, (_, i) => daysBefore(today, i + 1)));
  const last = new Map<string, { at: Date; window: ParkedEnergyWindow }>();
  for (const message of messages) {
    const day = dateOf(message.at.getTime() - 1);
    if (!wanted.has(day)) continue;
    const window = dayWindow(decodeParkedEnergy(message.payload));
    if (!window) continue;
    const kept = last.get(day);
    if (!kept || kept.at <= message.at) last.set(day, { at: message.at, window });
  }
  return [...last.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, { at, window }]) => ({
      day,
      at: at.toISOString(),
      minutes: window.minutes,
      kwh: window.kwh,
      rangeKm: window.rangeKm,
      uses: { ...window.uses },
    }));
}

/**
 * The last `days` full days of parked energy, read from the archive, which
 * already keeps every parked-energy payload: nothing extra is stored, and an
 * install has its history from the day it started archiving.
 */
export async function readParkedDays(
  archive: ParallaxArchive,
  vehicleId: string,
  days: number,
  zone: string,
  now = new Date(),
): Promise<ParkedDayDto[]> {
  // Two days spare covers any zone's offset and a DST change; the dates sort it out.
  const from = new Date(now.getTime() - (days + 2) * DAY_MS);
  const messages = await archive.messages(vehicleId, RVM_PARKED_ENERGY, from, now);
  return parkedDays(messages, days, zone, now);
}
