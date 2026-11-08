import { and, isNotNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { drives } from '../db/schema.js';
import type { Spot } from './locations.js';
import { haversineKm } from './state-utils.js';

/** A place named by where navigation took the vehicle, at where it parked. */
export interface NavigatedSpot extends Spot {
  name: string;
}

/** Parked this close to where navigation was headed, it got there. */
const ARRIVED_KM = 0.5;
/**
 * Where the parking spot's address has no house number (a park, a
 * campground, a big venue), the destination's pin can be well away from it.
 */
const ARRIVED_UNNUMBERED_KM = 2.5;

const startsWithNumber = (s: string) => /^\d/.test(s.trim());

/**
 * The name navigation gave the place a drive ended at, or null when it
 * didn't end there or the name is only an address (the looked-up one reads
 * as well). A charger's "Joshua Tree, CA [Rivian Adventure Network]" reads
 * "Rivian Adventure Network · Joshua Tree".
 */
export function navigatedName(d: {
  destinationName: string | null;
  destinationLat: number | null;
  destinationLon: number | null;
  endLat: number | null;
  endLon: number | null;
  endPlace: string | null;
}): string | null {
  const name = d.destinationName?.trim();
  if (!name || startsWithNumber(name)) return null;
  if (
    d.destinationLat == null ||
    d.destinationLon == null ||
    d.endLat == null ||
    d.endLon == null
  ) {
    return null;
  }
  const km = haversineKm(d.destinationLat, d.destinationLon, d.endLat, d.endLon);
  const numbered = d.endPlace != null && startsWithNumber(d.endPlace);
  if (km > (numbered ? ARRIVED_KM : ARRIVED_UNNUMBERED_KM)) return null;
  const network = /^(.*?)\s*\[(.+)\]$/.exec(name);
  if (!network) return name;
  const where = network[1]!.split(',')[0]!.trim();
  return where ? `${network[2]!.trim()} · ${where}` : network[2]!.trim();
}

/** Every place navigation named and the vehicle arrived at. */
export async function loadNavigatedSpots(db: Db): Promise<NavigatedSpot[]> {
  const rows = await db
    .select({
      destinationName: drives.destinationName,
      destinationLat: drives.destinationLat,
      destinationLon: drives.destinationLon,
      endLat: drives.endLat,
      endLon: drives.endLon,
      endPlace: drives.endPlace,
    })
    .from(drives)
    .where(and(isNotNull(drives.destinationName), isNotNull(drives.endedAt)));
  return rows.flatMap((row) => {
    const name = navigatedName(row);
    return name ? [{ name, lat: row.endLat!, lon: row.endLon! }] : [];
  });
}
