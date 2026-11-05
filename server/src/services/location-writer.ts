import { and, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { drives, locationPoints } from '../db/schema.js';
import { isPosition } from '../geo.js';
import type { GnssLocation, NavLocation, TimeStampedValue, VehicleState } from '../rivian/types.js';
import { haversineKm, stateLocation, stateNumber } from './state-utils.js';

export const MIN_MOVE_KM = 0.015;
/** Speed, heading and altitude count for a fix only if stamped this close to it. */
const SAME_FIX_MS = 60_000;
/**
 * A navigation fix stands in for the GNSS one only while it's this recent: a
 * minute, one GNSS cadence, so a gap in a live navigation stream hands back to
 * GNSS and a finished trip does too. Not the same question as the decoder's
 * `FIX_WITHIN_MS` (a frame's time against its own fix) or `SAME_FIX_MS` (a
 * reading against a fix it belongs to): this one is the fix against the clock.
 */
const NAV_FIX_FRESH_MS = 60_000;
/** A fix this recent with no drive around it belongs to the drive under way. */
const LIVE_FIX_MS = 5 * 60_000;

interface PerVehicle {
  lastLocation: { lat: number; lon: number; ts: string } | null;
  currentDriveId: number | null;
}

/**
 * Persists location points on movement, with speed, heading and altitude
 * when they were stamped with the fix.
 *
 * The fix comes from the navigation stream while the vehicle is navigating
 * (a point every few seconds) and from GNSS otherwise; see `liveFix`.
 *
 * A point is stored at its fix's time and belongs to the drive under way
 * then: Rivian can deliver fixes hours late (after the vehicle had no
 * signal), when another drive, or none, is in progress.
 *
 * States for a vehicle are handled one at a time, in the order they arrive.
 */
export class LocationWriter {
  private perVehicle = new Map<string, PerVehicle>();
  private queues = new Map<string, Promise<void>>();

  constructor(
    private readonly db: Db,
    private readonly now = () => Date.now(),
  ) {}

  setCurrentDrive(vehicleId: string, driveId: number | null): void {
    this.ensure(vehicleId).currentDriveId = driveId;
  }

  onState(vehicleId: string, state: VehicleState): Promise<void> {
    const snapshot = { ...state };
    const run = (this.queues.get(vehicleId) ?? Promise.resolve()).then(() =>
      this.maybeWriteLocation(vehicleId, this.ensure(vehicleId), snapshot),
    );
    this.queues.set(
      vehicleId,
      run.catch(() => {}),
    );
    return run;
  }

  private async maybeWriteLocation(
    vehicleId: string,
    pv: PerVehicle,
    state: VehicleState,
  ): Promise<void> {
    const live = liveFix(state, this.now());
    if (!live) return;
    const { location, fromNav } = live;
    const at = Date.parse(location.timeStamp);
    if (!Number.isFinite(at)) return;
    // Rivian reports speed in m/s. A navigation fix carries its own readings;
    // the GNSS ones were taken at a different instant, so only altitude comes
    // from them (navigation sends none, and height changes slowly).
    const speed = fromNav ? (location.speedMps ?? null) : alongside(state, 'gnssSpeed', at);
    const last = pv.lastLocation;
    if (last) {
      if (last.ts === location.timeStamp) return;
      // A live fix stamped before the last one came from the other stream, a
      // second away: storing it would step the track back. An old one is a fix
      // delivered late, which belongs to the drive it was taken on.
      if (at < Date.parse(last.ts) && this.now() - at < LIVE_FIX_MS) return;
      const movedKm = haversineKm(last.lat, last.lon, location.latitude, location.longitude);
      // The same fix re-sent under a newer stamp, often with a speed.
      if (movedKm === 0) return;
      if (movedKm < MIN_MOVE_KM && (speed ?? 0) <= 0) return;
    }
    pv.lastLocation = { lat: location.latitude, lon: location.longitude, ts: location.timeStamp };
    await this.db
      .insert(locationPoints)
      .values({
        vehicleId,
        ts: new Date(at),
        lat: location.latitude,
        lon: location.longitude,
        speedKmh: speed == null ? null : speed * 3.6,
        bearing: fromNav ? (location.bearing ?? null) : alongside(state, 'gnssBearing', at),
        altitude: alongside(state, 'gnssAltitude', at),
        driveId: await this.driveAt(vehicleId, pv, at),
      })
      // Already stored (e.g. Rivian's last fix again after a restart).
      .onConflictDoNothing();
  }

  /** The drive under way at `at`, by the drives' recorded times. */
  private async driveAt(vehicleId: string, pv: PerVehicle, at: number): Promise<number | null> {
    const when = new Date(at);
    const [drive] = await this.db
      .select({ id: drives.id })
      .from(drives)
      .where(
        and(
          eq(drives.vehicleId, vehicleId),
          lte(drives.startedAt, when),
          or(isNull(drives.endedAt), gte(drives.endedAt, when)),
        ),
      )
      .orderBy(desc(drives.startedAt))
      .limit(1);
    if (drive) return drive.id;
    // A live fix stamped just before the drive's start still belongs to it.
    return at >= this.now() - LIVE_FIX_MS ? pv.currentDriveId : null;
  }

  private ensure(vehicleId: string): PerVehicle {
    let pv = this.perVehicle.get(vehicleId);
    if (!pv) {
      pv = { lastLocation: null, currentDriveId: null };
      this.perVehicle.set(vehicleId, pv);
    }
    return pv;
  }
}

/** `key`'s value if it was stamped with the fix at `at` (or isn't stamped). */
function alongside(state: VehicleState, key: string, at: number): number | null {
  const stamp = (state[key] as TimeStampedValue | undefined)?.timeStamp;
  const stampedAt = stamp ? Date.parse(stamp) : Number.NaN;
  if (Number.isFinite(stampedAt) && Math.abs(stampedAt - at) > SAME_FIX_MS) return null;
  return stateNumber(state, key);
}

/**
 * The fix to store: a navigation frame's own while it's recent — a point every
 * few seconds, where a car without legacy GPS only has the GNSS one a minute —
 * else the GNSS fix. One track, one source: the two streams run about a second
 * apart, so switching per fix would put two clocks' worth of readings in one
 * track. "Recent" is either side of the clock, since the vehicle's clock and
 * ours differ by a second or two.
 */
function liveFix(
  state: VehicleState,
  now: number,
): { location: NavLocation; fromNav: true } | { location: GnssLocation; fromNav: false } | null {
  const nav = state.navLocation;
  const navAt = nav ? Date.parse(nav.timeStamp) : Number.NaN;
  if (
    nav &&
    isPosition(nav.latitude, nav.longitude) &&
    Number.isFinite(navAt) &&
    Math.abs(now - navAt) <= NAV_FIX_FRESH_MS
  ) {
    return { location: nav, fromNav: true };
  }
  const gnss = stateLocation(state);
  return gnss ? { location: gnss, fromNav: false } : null;
}
