import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { nearbySpot, wallboxSpots } from './locations.js';
import type { Db } from '../db/client.js';
import { type Logger, silentLogger } from '../logger.js';
import { chargingSessions, drives, geocodeCache, savedLocations, wallboxes } from '../db/schema.js';

export interface Place {
  /** Short label, e.g. "306 West Willow Street, Normal". */
  place: string;
  /** Full address. */
  address: string | null;
  /** Town and state, e.g. "Austin, TX". */
  area?: string | null;
}

/** Looks up a coordinate; null when nothing is there. Throws when the service fails. */
export type ReverseGeocode = (lat: number, lon: number) => Promise<Place | null>;

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';

/**
 * OpenStreetMap's Nominatim. Its usage policy asks for an identifying
 * User-Agent, at most one request a second and cached results, which
 * DrivePlaces provides.
 */
export function nominatimGeocoder(
  userAgent: string,
  fetchFn: typeof fetch = fetch,
): ReverseGeocode {
  return async (lat, lon) => {
    const url = `${NOMINATIM_URL}?format=jsonv2&addressdetails=1&zoom=18&lat=${lat}&lon=${lon}`;
    const res = await fetchFn(url, {
      headers: { 'User-Agent': userAgent, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
    return formatNominatim(await res.json());
  };
}

export interface FoundPlace {
  label: string;
  lat: number;
  lon: number;
}

/** Finds places matching typed text, best first, favoring ones near `near`. */
export type PlaceSearch = (
  query: string,
  near?: { lat: number; lon: number },
) => Promise<FoundPlace[]>;

const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
/** Nominatim allows one request a second. */
const SEARCH_GAP_MS = 1100;
/** Degrees around `near` that results are preferred within (~50 km). */
const NEAR_DEG = 0.5;

/**
 * Nominatim's search, run when the user asks (its usage policy rules out
 * searching as they type). Results near `near` rank first, without
 * excluding the rest.
 */
export function nominatimSearch(
  userAgent: string,
  fetchFn: typeof fetch = fetch,
  now: () => number = Date.now,
): PlaceSearch {
  let nextAt = 0;
  return async (query, near) => {
    const wait = nextAt - now();
    nextAt = Math.max(now(), nextAt) + SEARCH_GAP_MS;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const params = new URLSearchParams({ format: 'jsonv2', limit: '5', q: query });
    if (near) {
      const { lat, lon } = near;
      params.set(
        'viewbox',
        [lon - NEAR_DEG, lat + NEAR_DEG, lon + NEAR_DEG, lat - NEAR_DEG].join(','),
      );
    }
    const res = await fetchFn(`${NOMINATIM_SEARCH_URL}?${params}`, {
      headers: { 'User-Agent': userAgent, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
    const results = (await res.json()) as { display_name?: string; lat?: string; lon?: string }[];
    return results
      .map((r) => ({ label: r.display_name ?? '', lat: Number(r.lat), lon: Number(r.lon) }))
      .filter((r) => r.label && Number.isFinite(r.lat) && Number.isFinite(r.lon));
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
  const street = [a.house_number, a.road].filter(Boolean).join(' ') || a.neighbourhood || null;
  const locality = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.suburb ?? a.county ?? null;
  const parts = [street ?? result.name, locality].filter((p): p is string => !!p);
  const place = parts.length
    ? [...new Set(parts)].join(', ')
    : result.display_name.split(', ').slice(0, 2).join(', ');
  return { place, address: result.display_name, area: formatArea(a) };
}

/** Countries that usually write a state as its code. */
const STATE_CODE_COUNTRIES = new Set(['us', 'ca', 'au']);

/** The town and state, which names a charge away from any saved place. */
function formatArea(a: Record<string, string>): string | null {
  const town = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.municipality ?? a.suburb ?? a.county;
  const code = a['ISO3166-2-lvl4']?.split('-')[1];
  const region =
    code && STATE_CODE_COUNTRIES.has(a.country_code ?? '') ? code : (a.state ?? a.country);
  const parts = [town, region].filter((p): p is string => !!p);
  return parts.length > 0 ? [...new Set(parts)].join(', ') : null;
}

/** ~11 m cells, so nearby stops share a lookup. */
export function geocodeKey(lat: number, lon: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

/** Spacing between lookups (Nominatim allows one a second). */
const LOOKUP_SPACING_MS = 1_100;
/** Drives filled per pass of the backlog. */
const BACKLOG_BATCH = 200;

/** Lookups were turned off while a drive was being filled; it stays pending. */
class LookupsOff extends Error {}

/**
 * Fills in start and end places for finished drives, one lookup at a time
 * and newest first, reusing earlier results for nearby coordinates. A drive
 * whose lookup fails stays pending and is retried on the next pass. While
 * lookups are turned off, nothing is sent and drives stay pending.
 *
 * Also names imported charges, which come with a position and nothing to
 * call it, in the same queue so everything stays within Nominatim's limit.
 * One at a saved location or wall charger is already named by it, so it's
 * neither sent nor marked done: it needs a lookup if that location goes.
 */
export class DrivePlaces {
  private queue: number[] = [];
  private sessionQueue: number[] = [];
  /** More drives were waiting than the last pass queued. */
  private moreBacklog = false;
  private running = false;
  private stopped = false;
  private enabled = true;
  private lastLookupAt = 0;

  constructor(
    private readonly db: Db,
    private readonly geocode: ReverseGeocode,
    private readonly log: Logger = silentLogger,
    private readonly spacingMs = LOOKUP_SPACING_MS,
  ) {}

  /** Queues drives that finished without places (including older ones). */
  async start(): Promise<void> {
    this.stopped = false;
    if (!this.enabled) return;
    const pending = await this.db
      .select({ id: drives.id })
      .from(drives)
      .where(and(isNotNull(drives.endedAt), isNull(drives.placesCheckedAt)))
      .orderBy(desc(drives.startedAt))
      .limit(BACKLOG_BATCH);
    this.moreBacklog = pending.length === BACKLOG_BATCH;
    for (const { id } of pending) this.enqueue(id);
    await this.queueSessions();
  }

  /** Imported charges with nothing to call them, newest first. */
  private async queueSessions(): Promise<void> {
    const [pending, locations, boxes] = await Promise.all([
      this.db
        .select({ id: chargingSessions.id, lat: chargingSessions.lat, lon: chargingSessions.lon })
        .from(chargingSessions)
        .where(
          and(
            eq(chargingSessions.source, 'electrafi'),
            isNull(chargingSessions.placesCheckedAt),
            isNull(chargingSessions.vendor),
            isNull(chargingSessions.city),
            isNotNull(chargingSessions.lat),
          ),
        )
        .orderBy(desc(chargingSessions.startedAt)),
      this.db.select().from(savedLocations),
      this.db
        .select({ latitude: wallboxes.latitude, longitude: wallboxes.longitude })
        .from(wallboxes),
    ]);
    const spots = [...locations, ...wallboxSpots(boxes)];
    for (const { id, lat, lon } of pending) {
      if (nearbySpot(lat, lon, spots)) continue;
      if (!this.sessionQueue.includes(id)) this.sessionQueue.push(id);
    }
    if (this.sessionQueue.length > 0) void this.drain();
  }

  stop(): void {
    this.stopped = true;
    this.queue = [];
    this.sessionQueue = [];
  }

  /** Turns lookups on or off; turned back on, drives left pending meanwhile are queued. */
  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    if (!on) {
      this.queue = [];
      this.sessionQueue = [];
    } else if (!this.stopped) {
      this.start().catch((err: unknown) =>
        this.log.warn({ err }, 'could not list drives for place lookups'),
      );
    }
  }

  enqueue(driveId: number): void {
    if (this.stopped || !this.enabled || this.queue.includes(driveId)) return;
    this.queue.push(driveId);
    void this.drain();
  }

  /** Resolves once the queue is empty (for tests). */
  async idle(): Promise<void> {
    while (this.running || this.queue.length > 0 || this.sessionQueue.length > 0)
      await new Promise((r) => setTimeout(r, 10));
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // Drives first: one under way is being watched, and imports can wait.
      while (
        !this.stopped &&
        this.enabled &&
        (this.queue.length > 0 || this.sessionQueue.length > 0)
      ) {
        const driveId = this.queue.shift();
        const sessionId = driveId == null ? this.sessionQueue.shift() : undefined;
        try {
          if (driveId != null) await this.fill(driveId);
          else await this.fillSession(sessionId!);
        } catch (err) {
          if (err instanceof LookupsOff) break;
          // Leave it pending; the next start retries it.
          this.log.warn({ err, driveId, sessionId }, 'place lookup failed');
          if (this.queue.length + this.sessionQueue.length > 0) {
            this.log.warn('pausing place lookups until the next restart');
          }
          this.queue = [];
          this.sessionQueue = [];
          this.moreBacklog = false;
        }
      }
    } finally {
      this.running = false;
    }
    // A backlog bigger than a batch (a large import) carries on with the next.
    if (this.moreBacklog && !this.stopped && this.enabled) {
      this.moreBacklog = false;
      await this.start();
    }
  }

  private async fill(driveId: number): Promise<void> {
    const [drive] = await this.db.select().from(drives).where(eq(drives.id, driveId));
    if (!drive) return;
    if (!drive.endedAt) {
      // In progress: only the start is known. The end fills both, the start from cache.
      if (drive.startPlace != null) return;
      const start = await this.lookup(drive.startLat, drive.startLon);
      if (start) {
        await this.db
          .update(drives)
          .set({ startPlace: start.place, startAddress: start.address })
          .where(eq(drives.id, driveId));
      }
      return;
    }
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

  private async fillSession(sessionId: number): Promise<void> {
    const [session] = await this.db
      .select({ lat: chargingSessions.lat, lon: chargingSessions.lon })
      .from(chargingSessions)
      .where(eq(chargingSessions.id, sessionId));
    if (!session) return;
    const found = await this.lookup(session.lat, session.lon, true);
    await this.db
      .update(chargingSessions)
      .set({ city: found?.area ?? null, placesCheckedAt: new Date() })
      .where(eq(chargingSessions.id, sessionId));
  }

  /** `needArea`: a result from before areas were kept doesn't do, so it's looked up again. */
  private async lookup(
    lat: number | null,
    lon: number | null,
    needArea = false,
  ): Promise<Place | null> {
    if (lat == null || lon == null) return null;
    const key = geocodeKey(lat, lon);
    const [cached] = await this.db.select().from(geocodeCache).where(eq(geocodeCache.key, key));
    if (cached && !(needArea && cached.place && cached.area == null)) {
      return cached.place
        ? { place: cached.place, address: cached.address, area: cached.area }
        : null;
    }

    const wait = this.lastLookupAt + this.spacingMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    // Checked last, so nothing is sent once lookups are turned off.
    if (!this.enabled) throw new LookupsOff();
    this.lastLookupAt = Date.now();
    const found = await this.geocode(lat, lon);
    await this.db
      .insert(geocodeCache)
      .values({
        key,
        place: found?.place ?? null,
        address: found?.address ?? null,
        area: found?.area ?? null,
      })
      .onConflictDoUpdate({
        target: geocodeCache.key,
        set: { area: found?.area ?? null },
      });
    return found;
  }
}
