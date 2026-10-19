import type { ActivityKind } from '../../lib/vehicleStatus';
import { clock, shortDate } from '../../lib/format';

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

export function statusSentence(i: {
  kind: ActivityKind;
  /** Where it is: the last drive's end, or the charger it's plugged into. */
  place: string | null;
  /** When it arrived or plugged in (ms). */
  since: number | null;
  /** Navigation's destination while driving. */
  destination?: string | null;
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
        detail: i.speed ?? null,
      };
    case 'charging':
      return { kind: i.kind, headline: at('Charging'), detail: since };
    case 'plugged':
      return { kind: i.kind, headline: at('Plugged in'), detail: since };
    default:
      return { kind: i.kind, headline: at('Parked'), detail: since };
  }
}
