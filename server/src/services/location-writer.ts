import { and, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { drives, locationPoints } from '../db/schema.js';
import { isPosition } from '../geo.js';
import type { GnssLocation, TimeStampedValue, VehicleState } from '../rivian/types.js';
import { haversineKm, stateLocation, stateNumber } from './state-utils.js';

export const MIN_MOVE_KM = 0.015;
/** Speed, heading and altitude count for a fix only if stamped this close to it. */
const SAME_FIX_MS = 60_000;
/**
 * A GNSS fix this close in time to a navigation fix is left out: the two
 * streams run about a second apart, so storing both would put two clocks'
 * worth of readings in one track. Three navigation intervals (every 5 s), so
 * GNSS fills in only once navigation has actually stopped. Not the same
 * question as the decoder's `FIX_WITHIN_MS` (a frame's time against its own
 * fix) or `SAME_FIX_MS` (a reading against a fix it belongs to).
 */
const NAV_COVERS_MS = 15_000;
/** Navigation spans kept per vehicle, for GNSS fixes delivered late. */
const NAV_SPANS_KEPT = 64;
/** A fix this recent with no drive around it belongs to the drive under way. */
const LIVE_FIX_MS = 5 * 60_000;

/** What became of a fix: a row now, one already there, or why neither. */
type WriteResult = 'stored' | 'already-stored' | 'back-step' | 'unchanged';

interface PerVehicle {
  /** The newest fix stored, to measure movement from. */
  lastLocation: { lat: number; lon: number; ts: string } | null;
  currentDriveId: number | null;
  /**
   * The last navigation fix looked at, and the last GNSS fix settled (stored,
   * or left to navigation), so a state repeating one skips it. A GNSS fix
   * skipped as no move isn't settled: its speed can come in a later delta.
   */
  seenNav: string | null;
  seenGnss: string | null;
  /** When navigation fixes ran: runs of fixes under NAV_COVERS_MS apart. */
  navSpans: { from: number; to: number }[];
}

/**
 * Persists location points on movement, with speed, heading and altitude
 * when they were stamped with the fix.
 *
 * Every navigation fix is stored (a point every few seconds while the
 * vehicle is navigating), and a GNSS fix wherever no navigation fix is within
 * NAV_COVERS_MS of it. Both are judged by their own times, not by when they
 * arrived, so a late fix of either kind is filed like any other.
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
    const nav = state.navLocation;
    if (nav && nav.timeStamp !== pv.seenNav && isPosition(nav.latitude, nav.longitude)) {
      pv.seenNav = nav.timeStamp;
      const at = Date.parse(nav.timeStamp);
      if (Number.isFinite(at)) {
        // A navigation fix carries its own readings; the GNSS ones were taken
        // at a different instant, so only altitude comes from them
        // (navigation sends none, and height changes slowly).
        const result = await this.write(vehicleId, pv, state, nav, at, {
          speed: nav.speedMps ?? null,
          bearing: nav.bearing ?? null,
        });
        // A fix refused for stepping the track back stores no point, so it
        // must not claim the moment: its span would mute the GNSS fix that is
        // the only point there.
        if (result !== 'back-step') noteNavFix(pv, at);
      }
    }
    const gnss = stateLocation(state);
    if (gnss && gnss.timeStamp !== pv.seenGnss) {
      const at = Date.parse(gnss.timeStamp);
      if (!Number.isFinite(at)) return;
      if (navCovers(pv, at)) {
        pv.seenGnss = gnss.timeStamp;
        return;
      }
      // Rivian reports gnssSpeed in m/s.
      const result = await this.write(vehicleId, pv, state, gnss, at, {
        speed: alongside(state, 'gnssSpeed', at),
        bearing: alongside(state, 'gnssBearing', at),
      });
      if (result === 'stored' || result === 'already-stored') pv.seenGnss = gnss.timeStamp;
    }
  }

  private async write(
    vehicleId: string,
    pv: PerVehicle,
    state: VehicleState,
    location: GnssLocation,
    at: number,
    readings: { speed: number | null; bearing: number | null },
  ): Promise<WriteResult> {
    const { speed } = readings;
    const last = pv.lastLocation;
    const lastAt = last ? Date.parse(last.ts) : Number.NaN;
    if (last) {
      if (last.ts === location.timeStamp) return 'already-stored';
      // A live fix stamped before the last one came from the other stream, a
      // second away: storing it would step the track back. An old one is a fix
      // delivered late, which belongs to the drive it was taken on.
      if (at < lastAt && this.now() - at < LIVE_FIX_MS) return 'back-step';
      const movedKm = haversineKm(last.lat, last.lon, location.latitude, location.longitude);
      // The same fix re-sent under a newer stamp, often with a speed.
      if (movedKm === 0) return 'unchanged';
      if (movedKm < MIN_MOVE_KM && (speed ?? 0) <= 0) return 'unchanged';
    }
    // A late fix is stored but isn't where the vehicle is now.
    if (!last || at > lastAt) {
      pv.lastLocation = { lat: location.latitude, lon: location.longitude, ts: location.timeStamp };
    }
    await this.db
      .insert(locationPoints)
      .values({
        vehicleId,
        ts: new Date(at),
        lat: location.latitude,
        lon: location.longitude,
        speedKmh: speed == null ? null : speed * 3.6,
        bearing: readings.bearing,
        altitude: alongside(state, 'gnssAltitude', at),
        driveId: await this.driveAt(vehicleId, pv, at),
      })
      // Already stored (e.g. Rivian's last fix again after a restart).
      .onConflictDoNothing();
    return 'stored';
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
      pv = {
        lastLocation: null,
        currentDriveId: null,
        seenNav: null,
        seenGnss: null,
        navSpans: [],
      };
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

/** Records a navigation fix at `at`, joining it to a span it falls beside. */
function noteNavFix(pv: PerVehicle, at: number): void {
  const span = pv.navSpans.find((s) => at >= s.from - NAV_COVERS_MS && at <= s.to + NAV_COVERS_MS);
  if (span) {
    span.from = Math.min(span.from, at);
    span.to = Math.max(span.to, at);
    return;
  }
  pv.navSpans.push({ from: at, to: at });
  if (pv.navSpans.length > NAV_SPANS_KEPT) pv.navSpans.shift();
}

/** Whether a navigation fix stands for the moment `at`. */
function navCovers(pv: PerVehicle, at: number): boolean {
  return pv.navSpans.some((s) => at >= s.from - NAV_COVERS_MS && at <= s.to + NAV_COVERS_MS);
}
