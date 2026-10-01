import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { drives, geocodeCache } from "../db/schema.js";

export interface Place {
  /** Short label, e.g. "306 West Willow Street, Normal". */
  place: string;
  /** Full address. */
  address: string | null;
}

/** Looks up a coordinate; null when nothing is there. Throws when the service fails. */
export type ReverseGeocode = (lat: number, lon: number) => Promise<Place | null>;

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";

/**
 * OpenStreetMap's Nominatim. Its usage policy asks for an identifying
 * User-Agent, at most one request a second and cached results, which
 * DrivePlaces provides.
 */
export function nominatimGeocoder(userAgent: string, fetchFn: typeof fetch = fetch): ReverseGeocode {
  return async (lat, lon) => {
    const url = `${NOMINATIM_URL}?format=jsonv2&addressdetails=1&zoom=18&lat=${lat}&lon=${lon}`;
    const res = await fetchFn(url, {
      headers: { "User-Agent": userAgent, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
    return formatNominatim(await res.json());
  };
}

interface NominatimResult {
  error?: string;
  name?: string;
  display_name?: string;
  address?: Record<string, string>;
}

/**
 * A street address and town, which says where a drive went better than the
 * nearest named place (parking on a street can return a neighbouring
 * building's name). The named place stays in the full address.
 */
export function formatNominatim(result: NominatimResult): Place | null {
  if (!result || result.error || !result.display_name) return null;
  const a = result.address ?? {};
  const street = [a.house_number, a.road].filter(Boolean).join(" ") || a.neighbourhood || null;
  const locality = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.suburb ?? a.county ?? null;
  const parts = [street ?? result.name, locality].filter((p): p is string => !!p);
  const place = parts.length
    ? [...new Set(parts)].join(", ")
    : result.display_name.split(", ").slice(0, 2).join(", ");
  return { place, address: result.display_name };
}

/** ~11 m cells, so nearby stops share a lookup. */
export function geocodeKey(lat: number, lon: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

/** Spacing between lookups (Nominatim allows one a second). */
const LOOKUP_SPACING_MS = 1_100;
/** Drives filled per pass of the backlog. */
const BACKLOG_BATCH = 200;

/**
 * Fills in start and end places for finished drives, one lookup at a time
 * and newest first, reusing earlier results for nearby coordinates. A drive
 * whose lookup fails stays pending and is retried on the next pass.
 */
export class DrivePlaces {
  private queue: number[] = [];
  private running = false;
  private stopped = false;
  private lastLookupAt = 0;

  constructor(
    private readonly db: Db,
    private readonly geocode: ReverseGeocode,
    private readonly log: (msg: string) => void = () => {},
    private readonly spacingMs = LOOKUP_SPACING_MS,
  ) {}

  /** Queues drives that finished without places (including older ones). */
  async start(): Promise<void> {
    this.stopped = false;
    const pending = await this.db
      .select({ id: drives.id })
      .from(drives)
      .where(and(isNotNull(drives.endedAt), isNull(drives.placesCheckedAt)))
      .orderBy(desc(drives.startedAt))
      .limit(BACKLOG_BATCH);
    for (const { id } of pending) this.enqueue(id);
  }

  stop(): void {
    this.stopped = true;
    this.queue = [];
  }

  enqueue(driveId: number): void {
    if (this.stopped || this.queue.includes(driveId)) return;
    this.queue.push(driveId);
    void this.drain();
  }

  /** Resolves once the queue is empty (for tests). */
  async idle(): Promise<void> {
    while (this.running || this.queue.length > 0) await new Promise((r) => setTimeout(r, 10));
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (!this.stopped && this.queue.length > 0) {
        const driveId = this.queue.shift()!;
        try {
          await this.fill(driveId);
        } catch (err) {
          // Leave the drive pending; the next start retries it.
          this.log(`drive ${driveId} places: ${(err as Error).message}`);
          if (this.queue.length) this.log("pausing place lookups until the next restart");
          this.queue = [];
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async fill(driveId: number): Promise<void> {
    const [drive] = await this.db.select().from(drives).where(eq(drives.id, driveId));
    if (!drive || !drive.endedAt) return;
    const start = await this.lookup(drive.startLat, drive.startLon);
    const end = await this.lookup(drive.endLat, drive.endLon);
    await this.db
      .update(drives)
      .set({
        startPlace: start?.place ?? null,
        startAddress: start?.address ?? null,
        endPlace: end?.place ?? null,
        endAddress: end?.address ?? null,
        placesCheckedAt: new Date(),
      })
      .where(eq(drives.id, driveId));
  }

  private async lookup(lat: number | null, lon: number | null): Promise<Place | null> {
    if (lat == null || lon == null) return null;
    const key = geocodeKey(lat, lon);
    const [cached] = await this.db.select().from(geocodeCache).where(eq(geocodeCache.key, key));
    if (cached) return cached.place ? { place: cached.place, address: cached.address } : null;

    const wait = this.lastLookupAt + this.spacingMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastLookupAt = Date.now();
    const found = await this.geocode(lat, lon);
    await this.db
      .insert(geocodeCache)
      .values({ key, place: found?.place ?? null, address: found?.address ?? null })
      .onConflictDoNothing();
    return found;
  }
}
