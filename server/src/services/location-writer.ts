import { and, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { drives, locationPoints } from '../db/schema.js';
import type { TimeStampedValue, VehicleState } from '../rivian/types.js';
import { haversineKm, stateLocation, stateNumber } from './state-utils.js';

export const MIN_MOVE_KM = 0.015;
/** Speed, heading and altitude count for a fix only if stamped this close to it. */
const SAME_FIX_MS = 60_000;
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
    const loc = stateLocation(state);
    if (!loc) return;
    const at = Date.parse(loc.timeStamp);
    if (!Number.isFinite(at)) return;
    // Rivian reports gnssSpeed in m/s.
    const speed = alongside(state, 'gnssSpeed', at);
    const last = pv.lastLocation;
    if (last) {
      if (last.ts === loc.timeStamp) return;
      const movedKm = haversineKm(last.lat, last.lon, loc.latitude, loc.longitude);
      if (movedKm < MIN_MOVE_KM && (speed ?? 0) <= 0) return;
    }
    pv.lastLocation = { lat: loc.latitude, lon: loc.longitude, ts: loc.timeStamp };
    await this.db
      .insert(locationPoints)
      .values({
        vehicleId,
        ts: new Date(at),
        lat: loc.latitude,
        lon: loc.longitude,
        speedKmh: speed == null ? null : speed * 3.6,
        bearing: alongside(state, 'gnssBearing', at),
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
