import { elevationChange } from '../drive-metrics.js';
import { haversineKm } from '../state-utils.js';
import type { ElectraFiRow } from './parse.js';

/** Same rules as DriveDetector, so imported drives split where live ones do. */
export const PARK_GRACE_MS = 3 * 60_000;
export const DRIVE_GAP_MS = 15 * 60_000;
/** Rows farther apart than this are a hole in the data: no charging is counted across it. */
const CHARGE_GAP_MS = 5 * 60_000;
/** A charge's first row with more energy than this was already under way. */
const MID_CHARGE_KWH = 0.5;

export interface Readings {
  mileageM: number | null;
  battery: number | null;
  rangeKm: number | null;
  lat: number | null;
  lon: number | null;
}

export interface DriveSegment {
  startedAt: number;
  endedAt: number;
  start: Readings;
  end: Readings;
  batteryCapacityKwh: number | null;
  driveMode: string | null;
  distanceKm: number | null;
  elevationGainM: number | null;
  elevationLossM: number | null;
}

export interface CurveSample {
  at: number;
  powerKw: number | null;
  soc: number | null;
}

export interface ChargeSegment {
  chargeNumber: number;
  startedAt: number;
  endedAt: number;
  chargingSeconds: number;
  startSoc: number | null;
  endSoc: number | null;
  energyKwh: number | null;
  rangeAddedKm: number | null;
  avgPowerKw: number | null;
  maxPowerKw: number | null;
  lat: number | null;
  lon: number | null;
  curve: CurveSample[];
}

interface Timed {
  row: ElectraFiRow;
  at: number;
}

interface OpenDrive {
  first: Timed;
  start: Timed;
  lastMoving: Timed;
  /** The first row parked since it last moved, and the next after it. */
  parked: Timed | null;
  settled: Timed | null;
  altitudes: number[];
  gpsKm: number;
  gpsAt: { lat: number; lon: number } | null;
}

const readingsOf = (row: ElectraFiRow): Readings => ({
  mileageM: row.mileageM,
  battery: row.battery,
  rangeKm: row.rangeKm,
  lat: row.lat,
  lon: row.lon,
});

const isMoving = (row: ElectraFiRow) => row.gear === 'drive' || row.gear === 'reverse';

/**
 * Finds drives in an export's rows, by gear. A drive's first row comes up to
 * a poll after it set off, so it starts from the parked row just before,
 * which has the odometer before any distance was covered. It ends at its
 * first parked row, with the readings of the row after: the parked row's GPS
 * and odometer are often still catching up.
 *
 * Asleep rows have no readings and say nothing. A drive with no park before a
 * hole in the data ends at its last moving row; a later row may be weeks on.
 */
export class DriveSegmenter {
  private open: OpenDrive | null = null;
  private previous: Timed | null = null;

  /** Takes a row in order; returns any drive it finished. */
  push(row: ElectraFiRow, at: number): DriveSegment[] {
    if (row.mileageM == null) return [];
    const done: DriveSegment[] = [];
    const current = { row, at };
    const open = this.open;
    if (open) {
      const lastAt = (open.parked ?? open.lastMoving).at;
      if (at - lastAt > DRIVE_GAP_MS) this.finish(done);
    }
    if (isMoving(row)) this.onMoving(current, done);
    else if (row.gear === 'park') this.onParked(current, done);
    this.previous = current;
    return done;
  }

  /** Ends a drive still open at the end of the rows. */
  flush(): DriveSegment[] {
    const done: DriveSegment[] = [];
    this.finish(done);
    return done;
  }

  private onMoving(current: Timed, done: DriveSegment[]): void {
    if (this.open?.parked && current.at - this.open.parked.at >= PARK_GRACE_MS) this.finish(done);
    if (!this.open) {
      const before = this.previous;
      const start =
        before && before.row.gear === 'park' && current.at - before.at <= PARK_GRACE_MS
          ? before
          : current;
      this.open = {
        first: current,
        start,
        lastMoving: current,
        parked: null,
        settled: null,
        altitudes: [],
        gpsKm: 0,
        gpsAt: null,
      };
    }
    this.open.parked = null;
    this.open.settled = null;
    this.open.lastMoving = current;
    this.track(this.open, current.row);
  }

  private onParked(current: Timed, done: DriveSegment[]): void {
    const open = this.open;
    if (!open) return;
    if (!open.parked) {
      open.parked = current;
      this.track(open, current.row);
      return;
    }
    if (!open.settled) open.settled = current;
    if (current.at - open.parked.at >= PARK_GRACE_MS) this.finish(done);
  }

  private track(open: OpenDrive, row: ElectraFiRow): void {
    if (row.altitudeM != null) open.altitudes.push(row.altitudeM);
    if (row.lat == null || row.lon == null) return;
    if (open.gpsAt) open.gpsKm += haversineKm(open.gpsAt.lat, open.gpsAt.lon, row.lat, row.lon);
    open.gpsAt = { lat: row.lat, lon: row.lon };
  }

  private finish(done: DriveSegment[]): void {
    const open = this.open;
    this.open = null;
    if (!open) return;
    const parked = open.parked;
    const settled =
      parked && open.settled && open.settled.at - parked.at <= PARK_GRACE_MS ? open.settled : null;
    const end = (settled ?? parked ?? open.lastMoving).row;
    const start = open.start.row;
    const byOdometer =
      start.mileageM != null && end.mileageM != null && end.mileageM >= start.mileageM
        ? (end.mileageM - start.mileageM) / 1000
        : null;
    const elevation = elevationChange(open.altitudes);
    done.push({
      startedAt: open.first.at,
      endedAt: (parked ?? open.lastMoving).at,
      start: readingsOf(start),
      end: readingsOf(end),
      batteryCapacityKwh: open.first.row.capacityKwh,
      driveMode: open.first.row.driveMode,
      distanceKm: byOdometer || (open.gpsKm > 0 ? open.gpsKm : byOdometer),
      elevationGainM: elevation?.gainM ?? null,
      elevationLossM: elevation?.lossM ?? null,
    });
  }
}

interface OpenCharge extends ChargeSegment {
  firstEnergy: number | null;
  powerSum: number;
  powerCount: number;
  lastAt: number;
  lastCharging: boolean;
}

/**
 * Finds charges in an export's rows, by ElectraFi's charge number. A charge
 * that starts with energy already added began before the rows do, so its
 * starting level isn't known.
 */
export class ChargeSegmenter {
  private open: OpenCharge | null = null;

  push(row: ElectraFiRow, at: number): ChargeSegment[] {
    const done: ChargeSegment[] = [];
    if (this.open && this.open.chargeNumber !== row.chargeNumber) this.finish(done);
    if (row.chargeNumber == null) return done;
    const open = (this.open ??= {
      chargeNumber: row.chargeNumber,
      startedAt: at,
      endedAt: at,
      chargingSeconds: 0,
      startSoc: null,
      endSoc: null,
      energyKwh: null,
      rangeAddedKm: null,
      avgPowerKw: null,
      maxPowerKw: null,
      lat: row.lat,
      lon: row.lon,
      curve: [],
      firstEnergy: row.energyKwh,
      powerSum: 0,
      powerCount: 0,
      lastAt: at,
      lastCharging: false,
    });
    if (open.startSoc == null && open.curve.length === 0) open.startSoc = row.battery;
    if (open.lastCharging && at - open.lastAt <= CHARGE_GAP_MS) {
      open.chargingSeconds += (at - open.lastAt) / 1000;
    }
    open.endedAt = at;
    open.lastAt = at;
    open.lastCharging = row.charging === 'Charging';
    open.endSoc = row.battery ?? open.endSoc;
    if (row.energyKwh != null) open.energyKwh = Math.max(open.energyKwh ?? 0, row.energyKwh);
    open.rangeAddedKm = row.rangeAddedKm ?? open.rangeAddedKm;
    // The last row of a charge can be unplugged and still show the last power.
    if (open.lastCharging) {
      open.curve.push({ at, powerKw: row.powerKw, soc: row.battery });
      if (row.powerKw != null && row.powerKw > 0) {
        open.powerSum += row.powerKw;
        open.powerCount += 1;
        open.maxPowerKw = Math.max(open.maxPowerKw ?? 0, row.powerKw);
      }
    }
    return done;
  }

  flush(): ChargeSegment[] {
    const done: ChargeSegment[] = [];
    this.finish(done);
    return done;
  }

  private finish(done: ChargeSegment[]): void {
    const open = this.open;
    this.open = null;
    if (!open) return;
    done.push({
      chargeNumber: open.chargeNumber,
      startedAt: open.startedAt,
      endedAt: open.endedAt,
      chargingSeconds: Math.round(open.chargingSeconds),
      startSoc: (open.firstEnergy ?? 0) > MID_CHARGE_KWH ? null : open.startSoc,
      endSoc: open.endSoc,
      energyKwh: open.energyKwh,
      rangeAddedKm: open.rangeAddedKm,
      avgPowerKw: open.powerCount > 0 ? open.powerSum / open.powerCount : null,
      maxPowerKw: open.maxPowerKw,
      lat: open.lat,
      lon: open.lon,
      curve: open.curve,
    });
  }
}
