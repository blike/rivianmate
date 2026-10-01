import { and, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { drives, locationPoints } from "../db/schema.js";
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
 * A drive a previous run left open is picked up again when the vehicle is
 * still moving and the drive's last reading is this recent; otherwise it's
 * closed at that reading.
 */
const RESUME_WINDOW_MS = 15 * 60_000;

type Destination = TripInfo["destination"];

interface PerVehicle {
  driveId: number | null;
  /** Guards against concurrent startDrive while the insert is in flight. */
  starting: boolean;
  parkTimer: NodeJS.Timeout | null;
  startMileageM: number | null;
  /** When the vehicle was first seen parked during a drive (Rivian's time). */
  parkedAt: number | null;
  /** Latest full state, so a drive ends with its final readings. */
  latest: VehicleState | null;
  /** Whether a drive left open by a previous run has been dealt with. */
  resumeChecked: boolean;
  /** Where navigation is headed (null when not navigating). */
  destination: Destination | null;
}

/**
 * Detects drives from the state stream.
 * Start: gear enters drive/reverse, or powerState "go" while moving.
 * End: parked continuously for 3 minutes (grace period absorbs stops).
 *
 * Times come from Rivian's own stamps where it gives them, so a drive's
 * start and end don't depend on when RivianMate heard about them (late
 * deliveries after a reconnect, or the host waking from sleep). A drive
 * that's still going across a restart continues rather than splitting.
 */
export class DriveDetector {
  private perVehicle = new Map<string, PerVehicle>();

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
   * Monitored vehicles' open drives are resumed or closed on their first
   * state, when it's known whether they're still moving.
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
    for (const drive of open) await this.closeAtLastPoint(drive);
  }

  async onState(vehicleId: string, state: VehicleState): Promise<void> {
    const pv = this.ensure(vehicleId);
    pv.latest = state;
    const gear = stateString(state, "gearStatus");
    const power = stateString(state, "powerState");
    const speed = stateNumber(state, "gnssSpeed") ?? 0; // m/s

    const isMoving =
      gear === "drive" ||
      gear === "reverse" ||
      (power === "go" && speed > 1);

    if (!pv.resumeChecked) {
      pv.resumeChecked = true;
      await this.resumeOrCloseOpenDrive(vehicleId, pv, isMoving);
    }

    if (isMoving) {
      pv.parkedAt = null;
      if (pv.parkTimer) {
        clearTimeout(pv.parkTimer);
        pv.parkTimer = null;
      }
      if (pv.driveId === null && !pv.starting) {
        pv.starting = true;
        try {
          await this.startDrive(vehicleId, pv, state);
        } finally {
          pv.starting = false;
        }
      }
      return;
    }

    const isParked = gear === "park" || (power !== null && power !== "go");
    if (pv.driveId !== null && isParked && pv.parkedAt === null) {
      const now = this.now();
      pv.parkedAt = gear === "park" ? stampedAt(state, "gearStatus", now) : now;
      const driveId = pv.driveId;
      // Counted from when it parked, so a late delivery ends it promptly.
      const delay = Math.max(0, pv.parkedAt + this.parkGraceMs - now);
      pv.parkTimer = setTimeout(() => {
        pv.parkTimer = null;
        void this.endDrive(vehicleId, pv, driveId);
      }, delay);
    }
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

  private async resumeOrCloseOpenDrive(
    vehicleId: string,
    pv: PerVehicle,
    isMoving: boolean,
  ): Promise<void> {
    const open = await this.db
      .select()
      .from(drives)
      .where(and(eq(drives.vehicleId, vehicleId), isNull(drives.endedAt)))
      .orderBy(desc(drives.startedAt));
    const [latest, ...older] = open;
    for (const drive of older) await this.closeAtLastPoint(drive);
    if (!latest) return;

    const lastPoint = await this.lastPoint(latest.id);
    const lastSeen = (lastPoint?.ts ?? latest.startedAt).getTime();
    if (isMoving && this.now() - lastSeen <= RESUME_WINDOW_MS) {
      pv.driveId = latest.id;
      pv.startMileageM = latest.startMileageM;
      this.onDriveChange(vehicleId, latest.id);
    } else {
      await this.closeAtLastPoint(latest);
    }
  }

  private async startDrive(
    vehicleId: string,
    pv: PerVehicle,
    state: VehicleState,
  ): Promise<void> {
    const loc = stateLocation(state);
    const gear = stateString(state, "gearStatus");
    const now = this.now();
    pv.startMileageM = stateNumber(state, "vehicleMileage");
    const inserted = await this.db
      .insert(drives)
      .values({
        vehicleId,
        startedAt: new Date(
          gear === "drive" || gear === "reverse" ? stampedAt(state, "gearStatus", now) : now,
        ),
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
    this.onDriveChange(vehicleId, pv.driveId);
  }

  private async endDrive(vehicleId: string, pv: PerVehicle, driveId: number): Promise<void> {
    if (pv.driveId !== driveId) return;
    const state = pv.latest ?? {};
    const endedAt = pv.parkedAt ?? this.now();
    pv.driveId = null;
    pv.parkedAt = null;
    this.onDriveChange(vehicleId, null);

    const loc = stateLocation(state);
    const endMileageM = stateNumber(state, "vehicleMileage");
    let distanceKm = mileageDistanceKm(pv.startMileageM, endMileageM);
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
        endLat: loc?.latitude,
        endLon: loc?.longitude,
        endMileageM,
        endBattery: stateNumber(state, "batteryLevel"),
        endRangeKm: stateNumber(state, "distanceToEmpty"),
        distanceKm,
      })
      .where(and(eq(drives.id, driveId), isNull(drives.endedAt)));
  }

  /** Ends a drive at its last recorded point (its final readings are unknown). */
  private async closeAtLastPoint(drive: typeof drives.$inferSelect): Promise<void> {
    const lastPoint = await this.lastPoint(drive.id);
    const elevation = await driveElevation(this.db, drive.id);
    await this.db
      .update(drives)
      .set({
        endedAt: lastPoint?.ts ?? drive.startedAt,
        endLat: lastPoint?.lat,
        endLon: lastPoint?.lon,
        distanceKm: drive.distanceKm ?? (await this.sumPointDistance(drive.id)),
        elevationGainM: elevation?.gainM ?? null,
        elevationLossM: elevation?.lossM ?? null,
      })
      .where(and(eq(drives.id, drive.id), isNull(drives.endedAt)));
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
        parkedAt: null,
        latest: null,
        resumeChecked: false,
        destination: null,
      };
      this.perVehicle.set(vehicleId, pv);
    }
    return pv;
  }
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
