import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { drives, locationPoints } from "../db/schema.js";
import type { VehicleState } from "../rivian/types.js";
import { elevationChange } from "./drive-metrics.js";
import {
  stateLocation,
  stateNumber,
  stateString,
} from "./state-utils.js";

const PARK_GRACE_MS = 3 * 60_000;

interface PerVehicle {
  driveId: number | null;
  /** Guards against concurrent startDrive while the insert is in flight. */
  starting: boolean;
  parkTimer: NodeJS.Timeout | null;
  startMileageM: number | null;
}

/**
 * Detects drives from the state stream.
 * Start: gear enters drive/reverse, or powerState "go" while moving.
 * End: parked continuously for 3 minutes (grace period absorbs stops).
 */
export class DriveDetector {
  private perVehicle = new Map<string, PerVehicle>();

  constructor(
    private readonly db: Db,
    private readonly onDriveChange: (
      vehicleId: string,
      driveId: number | null,
    ) => void = () => {},
  ) {}

  /** Close drives left open by a previous process (crash/restart). */
  async closeDanglingDrives(): Promise<void> {
    const open = await this.db.select().from(drives).where(isNull(drives.endedAt));
    for (const drive of open) {
      const lastPoint = await this.db
        .select()
        .from(locationPoints)
        .where(eq(locationPoints.driveId, drive.id))
        .orderBy(desc(locationPoints.ts))
        .limit(1);
      const endedAt = lastPoint[0]?.ts ?? drive.startedAt;
      await this.db
        .update(drives)
        .set({
          endedAt,
          endLat: lastPoint[0]?.lat,
          endLon: lastPoint[0]?.lon,
          distanceKm: drive.distanceKm ?? (await this.sumPointDistance(drive.id)),
        })
        .where(eq(drives.id, drive.id));
    }
  }

  async onState(vehicleId: string, state: VehicleState): Promise<void> {
    const pv = this.ensure(vehicleId);
    const gear = stateString(state, "gearStatus");
    const power = stateString(state, "powerState");
    const speed = stateNumber(state, "gnssSpeed") ?? 0; // m/s

    const isMoving =
      gear === "drive" ||
      gear === "reverse" ||
      (power === "go" && speed > 1);

    if (isMoving) {
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
    if (pv.driveId !== null && isParked && !pv.parkTimer) {
      const driveId = pv.driveId;
      pv.parkTimer = setTimeout(() => {
        pv.parkTimer = null;
        void this.endDrive(vehicleId, pv, driveId, state);
      }, PARK_GRACE_MS);
    }
  }

  stop(): void {
    for (const pv of this.perVehicle.values()) {
      if (pv.parkTimer) clearTimeout(pv.parkTimer);
      pv.parkTimer = null;
    }
  }

  private async startDrive(
    vehicleId: string,
    pv: PerVehicle,
    state: VehicleState,
  ): Promise<void> {
    const loc = stateLocation(state);
    pv.startMileageM = stateNumber(state, "vehicleMileage");
    const inserted = await this.db
      .insert(drives)
      .values({
        vehicleId,
        startedAt: new Date(),
        startLat: loc?.latitude,
        startLon: loc?.longitude,
        startMileageM: pv.startMileageM,
        startBattery: stateNumber(state, "batteryLevel"),
        batteryCapacityKwh: stateNumber(state, "batteryCapacity"),
      })
      .returning({ id: drives.id });
    pv.driveId = inserted[0]!.id;
    this.onDriveChange(vehicleId, pv.driveId);
  }

  private async endDrive(
    vehicleId: string,
    pv: PerVehicle,
    driveId: number,
    state: VehicleState,
  ): Promise<void> {
    if (pv.driveId !== driveId) return;
    pv.driveId = null;
    this.onDriveChange(vehicleId, null);

    const loc = stateLocation(state);
    const endMileageM = stateNumber(state, "vehicleMileage");
    let distanceKm: number | null = null;
    if (endMileageM != null && pv.startMileageM != null) {
      distanceKm = Math.max(0, (endMileageM - pv.startMileageM) / 1000);
    }
    if (distanceKm == null || distanceKm === 0) {
      distanceKm = await this.sumPointDistance(driveId);
    }

    const elevation = await driveElevation(this.db, driveId);

    await this.db
      .update(drives)
      .set({
        elevationGainM: elevation?.gainM ?? null,
        elevationLossM: elevation?.lossM ?? null,
        endedAt: new Date(),
        endLat: loc?.latitude,
        endLon: loc?.longitude,
        endMileageM,
        endBattery: stateNumber(state, "batteryLevel"),
        distanceKm,
      })
      .where(and(eq(drives.id, driveId), isNull(drives.endedAt)));
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
      pv = { driveId: null, starting: false, parkTimer: null, startMileageM: null };
      this.perVehicle.set(vehicleId, pv);
    }
    return pv;
  }
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
