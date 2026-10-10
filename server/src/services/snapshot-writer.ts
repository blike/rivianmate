import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { drives, locationPoints, vehicleStateSnapshots } from "../db/schema.js";
import type { TimeStampedValue, VehicleState } from "../rivian/types.js";
import {
  haversineKm,
  stateLocation,
  stateNumber,
  stateString,
} from "./state-utils.js";

const ANCHOR_INTERVAL_MS = 15 * 60_000;
const MIN_WRITE_GAP_MS = 30_000;
const MIN_MOVE_KM = 0.015;
/** Speed, heading and altitude count for a fix only if stamped this close to it. */
const SAME_FIX_MS = 60_000;
/** A fix this recent with no drive around it belongs to the drive under way. */
const LIVE_FIX_MS = 5 * 60_000;

/** Enum-ish fields where any change is worth a snapshot row. */
const SIGNIFICANT_ENUM_FIELDS = [
  "powerState",
  "gearStatus",
  "chargerStatus",
  "chargerState",
  "chargePortState",
  "driveMode",
  "otaStatus",
  "otaCurrentStatus",
  "otaInstallReady",
];

interface PerVehicle {
  lastWriteAt: number;
  lastAnchorAt: number;
  lastWritten: {
    batteryLevel: number | null;
    rangeKm: number | null;
    mileageM: number | null;
    enums: string;
  } | null;
  lastLocation: { lat: number; lon: number; ts: string } | null;
  currentDriveId: number | null;
}

/**
 * Persists state history: snapshot rows on significant change (debounced)
 * plus an anchor row every 15 minutes, and location points on movement.
 *
 * A point is stored at its fix's time and belongs to the drive under way
 * then: Rivian can deliver fixes hours late (after the vehicle had no
 * signal), when another drive, or none, is in progress.
 */
export class SnapshotWriter {
  private perVehicle = new Map<string, PerVehicle>();

  constructor(private readonly db: Db, private readonly now = () => Date.now()) {}

  setCurrentDrive(vehicleId: string, driveId: number | null): void {
    this.ensure(vehicleId).currentDriveId = driveId;
  }

  async onState(vehicleId: string, state: VehicleState): Promise<void> {
    const pv = this.ensure(vehicleId);
    const nowMs = this.now();

    await this.maybeWriteLocation(vehicleId, pv, state);

    const metrics = {
      batteryLevel: stateNumber(state, "batteryLevel"),
      rangeKm: stateNumber(state, "distanceToEmpty"),
      mileageM: stateNumber(state, "vehicleMileage"),
      enums: SIGNIFICANT_ENUM_FIELDS.map((f) => stateString(state, f) ?? "").join(
        "|",
      ),
    };

    const isAnchor = nowMs - pv.lastAnchorAt >= ANCHOR_INTERVAL_MS;
    const debounced = nowMs - pv.lastWriteAt < MIN_WRITE_GAP_MS;
    const significant =
      pv.lastWritten === null ||
      metrics.enums !== pv.lastWritten.enums ||
      changedBy(metrics.batteryLevel, pv.lastWritten.batteryLevel, 0.5) ||
      changedBy(metrics.rangeKm, pv.lastWritten.rangeKm, 1) ||
      changedBy(metrics.mileageM, pv.lastWritten.mileageM, 100);

    if (!isAnchor && (!significant || debounced)) return;

    await this.db.insert(vehicleStateSnapshots).values({
      vehicleId,
      ts: new Date(nowMs),
      isAnchor,
      batteryLevel: metrics.batteryLevel,
      batteryLimit: stateNumber(state, "batteryLimit"),
      rangeKm: metrics.rangeKm,
      mileageM: metrics.mileageM,
      powerState: stateString(state, "powerState"),
      chargerStatus: stateString(state, "chargerStatus"),
      cabinTemp: stateNumber(state, "cabinClimateInteriorTemperature"),
      data: state,
    });

    pv.lastWriteAt = nowMs;
    if (isAnchor) pv.lastAnchorAt = nowMs;
    pv.lastWritten = metrics;
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
    const speed = alongside(state, "gnssSpeed", at);
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
        bearing: alongside(state, "gnssBearing", at),
        altitude: alongside(state, "gnssAltitude", at),
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
      pv = {
        lastWriteAt: 0,
        lastAnchorAt: 0,
        lastWritten: null,
        lastLocation: null,
        currentDriveId: null,
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

function changedBy(
  current: number | null,
  previous: number | null,
  threshold: number,
): boolean {
  if (current == null) return false;
  if (previous == null) return true;
  return Math.abs(current - previous) >= threshold;
}
