import { and, desc, eq, gte, inArray, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { drives, locationPoints, vehicleStateSnapshots } from "../db/schema.js";
import type { TripInfo } from "../rivian/parallax.js";
import type { VehicleState } from "../rivian/types.js";
import { stampedAt } from "./charging-time.js";
import { elevationChange } from "./drive-metrics.js";
import {
  stateLocation,
  stateNumber,
  stateString,
} from "./state-utils.js";

const PARK_GRACE_MS = 3 * 60_000;
/**
 * A drive a previous run left open is the same drive only if the vehicle's
 * next moving reading comes within this of its last one; otherwise it ended
 * at that last reading, unseen while RivianMate wasn't running.
 */
const RESUME_WINDOW_MS = 15 * 60_000;
/** A speed reading older than this doesn't show the vehicle is moving now. */
const FRESH_SPEED_MS = 2 * 60_000;
/** GPS this far behind the gear reading is reported as lagging. */
const GPS_LAG_MS = 5 * 60_000;

type Destination = TripInfo["destination"];

/** Readings a drive ends with. */
interface Readings {
  mileageM: number | null;
  battery: number | null;
  rangeKm: number | null;
  lat: number | null;
  lon: number | null;
}

interface PerVehicle {
  driveId: number | null;
  /** Guards against concurrent startDrive while the insert is in flight. */
  starting: boolean;
  parkTimer: NodeJS.Timeout | null;
  startMileageM: number | null;
  /** When the drive started (Rivian's time). */
  startedAt: number | null;
  /** When the vehicle was first seen parked during a drive (Rivian's time). */
  parkedAt: number | null;
  /** The drive's latest moving reading (Rivian's time), and the readings then. */
  lastMovingAt: number | null;
  lastMovingReadings: Readings | null;
  /** The drive was left open by a previous run and isn't known to be going yet. */
  adopted: boolean;
  /** When the previous drive ended; readings from before it belong to that drive. */
  lastEndedAt: number | null;
  /** Latest full state, so a drive ends with its final readings. */
  latest: VehicleState | null;
  /** Whether a drive left open by a previous run has been dealt with. */
  resumeChecked: boolean;
  /** Where navigation is headed (null when not navigating). */
  destination: Destination | null;
  /** Whether the drive's GPS is lagging its other readings (for logging). */
  gpsLagging: boolean;
}

/**
 * Detects drives from the state stream.
 * Start: gear enters drive/reverse, or powerState "go" with a current speed.
 * End: parked continuously for 3 minutes (grace period absorbs stops).
 *
 * Times come from Rivian's own stamps where it gives them, so a drive's
 * start and end don't depend on when RivianMate heard about them. Rivian
 * holds back readings while the vehicle has no signal and delivers them
 * later, so a whole drive can arrive hours late, stamped with when it
 * happened; it's recorded at those times. A reading stamped before the
 * drive's latest movement can't end it. A drive left open by a previous
 * run is picked up again: what the vehicle reports next shows whether it's
 * still going, ended at a park delivered late, or ended unseen.
 *
 * States are handled one at a time, in the order they arrive.
 */
export class DriveDetector {
  private perVehicle = new Map<string, PerVehicle>();
  private queues = new Map<string, Promise<void>>();
  /** A drive was closed (e.g. to look up its places). */
  onDriveEnded?: (driveId: number) => void;
  log?: (msg: string) => void;

  constructor(
    private readonly db: Db,
    private readonly onDriveChange: (
      vehicleId: string,
      driveId: number | null,
    ) => void = () => {},
    private readonly now: () => number = Date.now,
    private readonly parkGraceMs = PARK_GRACE_MS,
  ) {}

  /**
   * Close drives left open for vehicles that aren't monitored any more.
   * Monitored vehicles' open drives are picked up on their first state.
   */
  async closeDanglingDrives(monitoredVehicleIds: readonly string[] = []): Promise<void> {
    const open = await this.db
      .select()
      .from(drives)
      .where(
        monitoredVehicleIds.length
          ? and(isNull(drives.endedAt), notInArray(drives.vehicleId, [...monitoredVehicleIds]))
          : isNull(drives.endedAt),
      );
    for (const drive of open) await this.closeAtLastReading(drive);
  }

  /** Handles a state; calls for a vehicle run in order, each on the state as it was. */
  onState(vehicleId: string, state: VehicleState): Promise<void> {
    const snapshot = { ...state };
    const run = (this.queues.get(vehicleId) ?? Promise.resolve()).then(() =>
      this.process(vehicleId, snapshot),
    );
    this.queues.set(vehicleId, run.catch(() => {}));
    return run;
  }

  private async process(vehicleId: string, state: VehicleState): Promise<void> {
    const pv = this.ensure(vehicleId);
    pv.latest = state;
    const now = this.now();
    const gear = stateString(state, "gearStatus");
    const power = stateString(state, "powerState");
    // Rivian keeps the last speed while it hears nothing new, so an old
    // reading says nothing about now.
    const speedIsCurrent = now - stampedAt(state, "gnssSpeed", now) <= FRESH_SPEED_MS;
    const speed = speedIsCurrent ? stateNumber(state, "gnssSpeed") ?? 0 : 0; // m/s

    const byGear = gear === "drive" || gear === "reverse";
    const isMoving = byGear || (power === "go" && speed > 1);

    if (!pv.resumeChecked) {
      pv.resumeChecked = true;
      await this.adoptOpenDrive(vehicleId, pv);
    }

    if (isMoving) {
      const movingAt = byGear ? stampedAt(state, "gearStatus", now) : now;
      await this.onMoving(vehicleId, pv, state, movingAt);
      this.noteGpsLag(pv, state, movingAt);
      return;
    }

    const isParked = gear === "park" || (power !== null && power !== "go");
    if (pv.driveId !== null && isParked && pv.parkedAt === null) {
      await this.onParked(vehicleId, pv, gear === "park" ? stampedAt(state, "gearStatus", now) : now);
    }
  }

  private async onMoving(
    vehicleId: string,
    pv: PerVehicle,
    state: VehicleState,
    movingAt: number,
  ): Promise<void> {
    if (pv.driveId !== null) {
      if (pv.parkedAt !== null) {
        // From before it parked (delivered late): the park still stands.
        if (movingAt < pv.parkedAt) return;
        // Parked for longer than the grace, told late before the timer fired.
        if (movingAt - pv.parkedAt >= this.parkGraceMs) await this.endDrive(vehicleId, pv, pv.driveId);
      } else if (pv.adopted && pv.lastMovingAt !== null && movingAt > pv.lastMovingAt) {
        if (movingAt - pv.lastMovingAt > RESUME_WINDOW_MS) {
          // Moving again long after the drive's last reading: that drive
          // ended unseen, and this is a new one.
          await this.endDrive(vehicleId, pv, pv.driveId, { at: pv.lastMovingAt, readings: pv.lastMovingReadings });
        } else {
          pv.adopted = false;
          this.log?.(`[drive] #${pv.driveId} is still going; resumed`);
        }
      }
    }

    if (pv.driveId !== null) {
      pv.parkedAt = null;
      if (pv.parkTimer) {
        clearTimeout(pv.parkTimer);
        pv.parkTimer = null;
      }
      // The drive started before we first heard (its first readings came late).
      if (pv.startedAt !== null && movingAt < pv.startedAt && movingAt > (pv.lastEndedAt ?? -Infinity)) {
        await this.moveStart(pv, movingAt, state);
      }
      if (movingAt >= (pv.lastMovingAt ?? -Infinity)) {
        pv.lastMovingAt = movingAt;
        pv.lastMovingReadings = readingsOf(state);
      }
      return;
    }

    // Part of a drive that's already over (delivered late).
    if (pv.lastEndedAt !== null && movingAt <= pv.lastEndedAt) return;
    if (pv.starting) return;
    pv.starting = true;
    try {
      await this.startDrive(vehicleId, pv, state, movingAt);
    } finally {
      pv.starting = false;
    }
  }

  private async onParked(vehicleId: string, pv: PerVehicle, parkedAt: number): Promise<void> {
    const driveId = pv.driveId!;
    // A park from before the drive's latest movement (late, or Rivian's
    // last known gear while the vehicle had no signal) didn't end it.
    if (pv.lastMovingAt !== null && parkedAt < pv.lastMovingAt) return;
    pv.parkedAt = parkedAt;
    // Counted from when it parked, so a late delivery ends it promptly.
    const delay = Math.max(0, parkedAt + this.parkGraceMs - this.now());
    pv.parkTimer = setTimeout(() => {
      pv.parkTimer = null;
      void this.endDrive(vehicleId, pv, driveId);
    }, delay);
  }

  /**
   * The vehicle's navigation destination (null when it stops navigating).
   * Recorded on the drive in progress, or on the next one to start.
   */
  async noteDestination(vehicleId: string, destination: Destination | null): Promise<void> {
    const pv = this.ensure(vehicleId);
    const same =
      destination?.name === pv.destination?.name &&
      destination?.lat === pv.destination?.lat &&
      destination?.lon === pv.destination?.lon;
    pv.destination = destination;
    if (same || !destination || pv.driveId === null) return;
    await this.db
      .update(drives)
      .set(destinationColumns(destination))
      .where(eq(drives.id, pv.driveId));
  }

  stop(): void {
    for (const pv of this.perVehicle.values()) {
      if (pv.parkTimer) clearTimeout(pv.parkTimer);
      pv.parkTimer = null;
    }
  }

  /**
   * Picks up the drive a previous run left open; what the vehicle reports
   * next decides whether it's still going. Older open drives are closed.
   */
  private async adoptOpenDrive(vehicleId: string, pv: PerVehicle): Promise<void> {
    const open = await this.db
      .select()
      .from(drives)
      .where(and(eq(drives.vehicleId, vehicleId), isNull(drives.endedAt)))
      .orderBy(desc(drives.startedAt));
    const [latest, ...older] = open;
    for (const drive of older) await this.closeAtLastReading(drive);

    const [previous] = await this.db
      .select({ endedAt: drives.endedAt })
      .from(drives)
      .where(and(eq(drives.vehicleId, vehicleId), isNotNull(drives.endedAt)))
      .orderBy(desc(drives.endedAt))
      .limit(1);
    pv.lastEndedAt = previous?.endedAt?.getTime() ?? null;
    if (!latest) return;

    const last = await this.lastMovingReading(latest);
    pv.driveId = latest.id;
    pv.startedAt = latest.startedAt.getTime();
    pv.startMileageM = latest.startMileageM;
    pv.lastMovingAt = last.at;
    pv.lastMovingReadings = last.readings;
    pv.adopted = true;
    this.onDriveChange(vehicleId, latest.id);
    this.log?.(`[drive] picked up #${latest.id} left open; last moving reading ${iso(last.at)}`);
  }

  private async startDrive(
    vehicleId: string,
    pv: PerVehicle,
    state: VehicleState,
    startedAt: number,
  ): Promise<void> {
    const loc = stateLocation(state);
    pv.startMileageM = stateNumber(state, "vehicleMileage");
    const inserted = await this.db
      .insert(drives)
      .values({
        vehicleId,
        startedAt: new Date(startedAt),
        startLat: loc?.latitude,
        startLon: loc?.longitude,
        startMileageM: pv.startMileageM,
        startBattery: stateNumber(state, "batteryLevel"),
        startRangeKm: stateNumber(state, "distanceToEmpty"),
        batteryCapacityKwh: stateNumber(state, "batteryCapacity"),
        driveMode: stateString(state, "driveMode"),
        ...(pv.destination ? destinationColumns(pv.destination) : {}),
      })
      .returning({ id: drives.id });
    pv.driveId = inserted[0]!.id;
    pv.startedAt = startedAt;
    pv.lastMovingAt = startedAt;
    pv.lastMovingReadings = readingsOf(state);
    pv.gpsLagging = false;
    this.onDriveChange(vehicleId, pv.driveId);
    const late = this.now() - startedAt > RESUME_WINDOW_MS ? " (delivered late)" : "";
    this.log?.(`[drive] started #${pv.driveId} at ${iso(startedAt)}${late}`);
  }

  /** Moves the drive's start earlier, to a moving reading that arrived after it started. */
  private async moveStart(pv: PerVehicle, at: number, state: VehicleState): Promise<void> {
    pv.startedAt = at;
    const mileage = stateNumber(state, "vehicleMileage");
    if (mileage != null && (pv.startMileageM == null || mileage < pv.startMileageM)) {
      pv.startMileageM = mileage;
    }
    await this.db
      .update(drives)
      .set({ startedAt: new Date(at), startMileageM: pv.startMileageM })
      .where(eq(drives.id, pv.driveId!));
    this.log?.(`[drive] #${pv.driveId} started earlier than first heard: ${iso(at)}`);
  }

  /**
   * Ends the drive: by default when it parked, with the latest readings;
   * `end` gives another time and readings (e.g. its last moving reading).
   */
  private async endDrive(
    vehicleId: string,
    pv: PerVehicle,
    driveId: number,
    end?: { at: number; readings: Readings | null },
  ): Promise<void> {
    if (pv.driveId !== driveId) return;
    if (pv.parkTimer) {
      clearTimeout(pv.parkTimer);
      pv.parkTimer = null;
    }
    const at = end?.at ?? pv.parkedAt ?? this.now();
    const readings = end ? end.readings : readingsOf(pv.latest ?? {});
    // Never before it started, whatever a stamp says.
    const endedAt = Math.max(at, pv.startedAt ?? at);
    const startMileageM = pv.startMileageM;
    pv.driveId = null;
    pv.parkedAt = null;
    pv.startedAt = null;
    pv.lastMovingAt = null;
    pv.lastMovingReadings = null;
    pv.adopted = false;
    pv.lastEndedAt = endedAt;
    this.onDriveChange(vehicleId, null);

    let distanceKm = mileageDistanceKm(startMileageM, readings?.mileageM ?? null);
    if (distanceKm == null || distanceKm === 0) {
      distanceKm = await this.sumPointDistance(driveId);
    }

    const elevation = await driveElevation(this.db, driveId);

    await this.db
      .update(drives)
      .set({
        elevationGainM: elevation?.gainM ?? null,
        elevationLossM: elevation?.lossM ?? null,
        endedAt: new Date(endedAt),
        endLat: readings?.lat,
        endLon: readings?.lon,
        endMileageM: readings?.mileageM,
        endBattery: readings?.battery,
        endRangeKm: readings?.rangeKm,
        distanceKm,
      })
      .where(and(eq(drives.id, driveId), isNull(drives.endedAt)));
    this.log?.(`[drive] ended #${driveId} at ${iso(endedAt)}${end ? " (last moving reading)" : ""}`);
    this.onDriveEnded?.(driveId);
  }

  /** Ends a drive nobody is watching at its last moving reading. */
  private async closeAtLastReading(drive: typeof drives.$inferSelect): Promise<void> {
    const last = await this.lastMovingReading(drive);
    const readings = last.readings;
    const elevation = await driveElevation(this.db, drive.id);
    await this.db
      .update(drives)
      .set({
        endedAt: new Date(last.at),
        endLat: readings?.lat,
        endLon: readings?.lon,
        endMileageM: readings?.mileageM,
        endBattery: readings?.battery,
        endRangeKm: readings?.rangeKm,
        distanceKm:
          drive.distanceKm ??
          mileageDistanceKm(drive.startMileageM, readings?.mileageM ?? null) ??
          (await this.sumPointDistance(drive.id)),
        elevationGainM: elevation?.gainM ?? null,
        elevationLossM: elevation?.lossM ?? null,
      })
      .where(and(eq(drives.id, drive.id), isNull(drives.endedAt)));
    this.log?.(`[drive] closed #${drive.id} at its last moving reading, ${iso(last.at)}`);
    this.onDriveEnded?.(drive.id);
  }

  /**
   * A drive's latest moving reading as recorded: its last GPS point or the
   * last state seen in drive/reverse, whichever is later (never before it
   * started), with the readings then.
   */
  private async lastMovingReading(
    drive: typeof drives.$inferSelect,
  ): Promise<{ at: number; readings: Readings | null }> {
    const point = await this.lastPoint(drive.id);
    const [snapshot] = await this.db
      .select({ ts: vehicleStateSnapshots.ts, data: vehicleStateSnapshots.data })
      .from(vehicleStateSnapshots)
      .where(
        and(
          eq(vehicleStateSnapshots.vehicleId, drive.vehicleId),
          gte(vehicleStateSnapshots.ts, drive.startedAt),
          sql`${vehicleStateSnapshots.data}->'gearStatus'->>'value' IN ('drive', 'reverse')`,
        ),
      )
      .orderBy(desc(vehicleStateSnapshots.ts))
      .limit(1);

    let at = drive.startedAt.getTime();
    let readings: Readings | null = null;
    if (snapshot) {
      const state = snapshot.data as VehicleState;
      at = Math.max(at, stampedAt(state, "gearStatus", snapshot.ts.getTime()));
      readings = readingsOf(state);
    }
    if (point) {
      at = Math.max(at, point.ts.getTime());
      readings = { ...(readings ?? NO_READINGS), lat: point.lat, lon: point.lon };
    }
    return { at, readings };
  }

  /** Logs when a drive's GPS falls behind its gear readings, and when it catches up. */
  private noteGpsLag(pv: PerVehicle, state: VehicleState, movingAt: number): void {
    if (pv.driveId === null) return;
    const gpsAt = Date.parse(state.gnssLocation?.timeStamp ?? "");
    if (!Number.isFinite(gpsAt)) return;
    const lagging = movingAt - gpsAt > GPS_LAG_MS;
    if (lagging === pv.gpsLagging) return;
    pv.gpsLagging = lagging;
    this.log?.(
      lagging
        ? `[drive] #${pv.driveId}: GPS from Rivian is ${Math.round((movingAt - gpsAt) / 60_000)} min behind`
        : `[drive] #${pv.driveId}: GPS caught up`,
    );
  }

  private async lastPoint(driveId: number) {
    const [point] = await this.db
      .select()
      .from(locationPoints)
      .where(eq(locationPoints.driveId, driveId))
      .orderBy(desc(locationPoints.ts))
      .limit(1);
    return point;
  }

  private async sumPointDistance(driveId: number): Promise<number | null> {
    const result = await this.db.execute<{ km: number | null }>(sql`
      SELECT SUM(
        2 * 6371 * ASIN(SQRT(
          POWER(SIN(RADIANS(lat - prev_lat) / 2), 2) +
          COS(RADIANS(prev_lat)) * COS(RADIANS(lat)) *
          POWER(SIN(RADIANS(lon - prev_lon) / 2), 2)
        ))
      ) AS km
      FROM (
        SELECT lat, lon,
          LAG(lat) OVER (ORDER BY ts) AS prev_lat,
          LAG(lon) OVER (ORDER BY ts) AS prev_lon
        FROM location_points WHERE drive_id = ${driveId}
      ) p WHERE prev_lat IS NOT NULL
    `);
    const km = result[0]?.km;
    return km == null ? null : Number(km);
  }

  private ensure(vehicleId: string): PerVehicle {
    let pv = this.perVehicle.get(vehicleId);
    if (!pv) {
      pv = {
        driveId: null,
        starting: false,
        parkTimer: null,
        startMileageM: null,
        startedAt: null,
        parkedAt: null,
        lastMovingAt: null,
        lastMovingReadings: null,
        adopted: false,
        lastEndedAt: null,
        latest: null,
        resumeChecked: false,
        destination: null,
        gpsLagging: false,
      };
      this.perVehicle.set(vehicleId, pv);
    }
    return pv;
  }
}

const NO_READINGS: Readings = { mileageM: null, battery: null, rangeKm: null, lat: null, lon: null };

function readingsOf(state: VehicleState): Readings {
  const loc = stateLocation(state);
  return {
    mileageM: stateNumber(state, "vehicleMileage"),
    battery: stateNumber(state, "batteryLevel"),
    rangeKm: stateNumber(state, "distanceToEmpty"),
    lat: loc?.latitude ?? null,
    lon: loc?.longitude ?? null,
  };
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function destinationColumns(destination: Destination) {
  return {
    destinationName: destination.name,
    destinationLat: destination.lat,
    destinationLon: destination.lon,
  };
}

/** Odometer distance, or null when either reading is missing or it went backwards. */
export function mileageDistanceKm(startM: number | null, endM: number | null): number | null {
  if (startM == null || endM == null || endM < startM) return null;
  return (endM - startM) / 1000;
}

/** Elevation gain/loss from a drive's recorded GPS altitudes. */
export async function driveElevation(
  db: Db,
  driveId: number,
): Promise<{ gainM: number; lossM: number } | null> {
  const rows = await db
    .select({ altitude: locationPoints.altitude })
    .from(locationPoints)
    .where(eq(locationPoints.driveId, driveId))
    .orderBy(locationPoints.ts);
  return elevationChange(
    rows.map((r) => r.altitude).filter((a): a is number => a != null),
  );
}

/** Fastest recorded speed per drive (km/h). */
export async function maxSpeeds(db: Db, driveIds: number[]): Promise<Map<number, number>> {
  if (driveIds.length === 0) return new Map();
  const rows = await db
    .select({ driveId: locationPoints.driveId, max: sql<number | null>`MAX(${locationPoints.speedKmh})` })
    .from(locationPoints)
    .where(inArray(locationPoints.driveId, driveIds))
    .groupBy(locationPoints.driveId);
  return new Map(
    rows.filter((r) => r.driveId != null && r.max != null).map((r) => [r.driveId!, Number(r.max)]),
  );
}
