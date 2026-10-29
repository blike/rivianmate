import type { ActivityKind } from '../../lib/vehicleStatus';
import { clock, shortDate } from '../../lib/format';
import { haversineKm } from '../../lib/geo';
import { moreStops } from '../../lib/navigation';

/** Farther than this from where the last drive ended, it has moved since. */
const MOVED_KM = 0.3;

/** The dashboard's headline: what the vehicle is doing, where, and since when. */
export interface StatusSentence {
  kind: ActivityKind;
  /** "Parked at Home", "Charging at Rivian", "Driving to Costco". */
  headline: string;
  /** Quieter text after it: "since 6:42 PM", "54 mph". */
  detail: string | null;
}

/**
 * "since 6:42 PM" today, "since yesterday, 6:42 PM", or "since Oct 10"
 * further back.
 */
export function sinceLabel(at: number, now: number): string {
  const day = (t: number) => new Date(t).setHours(0, 0, 0, 0);
  const days = Math.round((day(now) - day(at)) / 86_400_000);
  if (days <= 0) return `since ${clock(at)}`;
  if (days === 1) return `since yesterday, ${clock(at)}`;
  return `since ${shortDate(at)}`;
}

/**
 * Whether the vehicle is still where a drive ended, so that drive can say
 * where it's parked. Drives missed while RivianMate was off leave the last
 * recorded one ending somewhere else; without both positions, assume so.
 */
export function stillAtDriveEnd(
  drive: { endLat: number | null; endLon: number | null },
  at: { lat: number; lon: number } | null,
): boolean {
  if (drive.endLat == null || drive.endLon == null || !at) return true;
  return haversineKm(drive.endLat, drive.endLon, at.lat, at.lon) <= MOVED_KM;
}

export function statusSentence(i: {
  kind: ActivityKind;
  /** Where it is: the last drive's end, or the charger it's plugged into. */
  place: string | null;
  /** When it arrived or plugged in (ms). */
  since: number | null;
  /** Where navigation is headed next while driving. */
  destination?: string | null;
  /** Navigation's stops after that one. */
  stopsAfter?: number;
  /** Formatted speed while driving. */
  speed?: string | null;
  now: number;
}): StatusSentence {
  const at = (verb: string) => (i.place ? `${verb} at ${i.place}` : verb);
  const since = i.since != null && i.since <= i.now ? sinceLabel(i.since, i.now) : null;
  switch (i.kind) {
    case 'driving':
      return {
        kind: i.kind,
        headline: i.destination ? `Driving to ${i.destination}` : 'Driving',
        detail:
          [i.destination && moreStops(i.stopsAfter ?? 0), i.speed].filter(Boolean).join(' · ') ||
          null,
      };
    case 'charging':
      return { kind: i.kind, headline: at('Charging'), detail: since };
    case 'plugged':
      return { kind: i.kind, headline: at('Plugged in'), detail: since };
    default:
      return { kind: i.kind, headline: at('Parked'), detail: since };
  }
}
