import { Transform } from 'node:stream';
import type { ImportFormat } from '../../api-types.js';
import type { VehicleState } from '../../rivian/types.js';

/** Something the user can act on; the route answers with its message. */
export class ImportError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** Stops a stream past `limit` bytes, so a small archive can't fill the disk. */
export function capped(limit: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      seen += chunk.length;
      if (seen > limit) done(new ImportError('This file is too large to import.', 413));
      else done(null, chunk);
    },
  });
}

export interface Readings {
  mileageM: number | null;
  battery: number | null;
  rangeKm: number | null;
  lat: number | null;
  lon: number | null;
}

export interface Destination {
  name: string;
  lat: number;
  lon: number;
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
  /** The name of the driver profile the vehicle reported, where the export has it. */
  driverName: string | null;
  /** Where the vehicle's navigation was headed. */
  destination: Destination | null;
}

/** A place the owner named in the other app. */
export interface ImportPlace {
  name: string;
  lat: number;
  lon: number;
  radiusM: number;
  isHome: boolean;
  /** Price per kWh charged there; null = not set. */
  ratePerKwh: number | null;
}

export interface CurveSample {
  at: number;
  powerKw: number | null;
  soc: number | null;
}

export interface ChargeSegment {
  startedAt: number;
  endedAt: number;
  chargingSeconds: number;
  startSoc: number | null;
  endSoc: number | null;
  energyKwh: number | null;
  /** Rivian's breakdown, where the export has it: into the pack, and heating or cooling it. */
  packKwh: number | null;
  thermalKwh: number | null;
  rangeAddedKm: number | null;
  avgPowerKw: number | null;
  maxPowerKw: number | null;
  lat: number | null;
  lon: number | null;
  curve: CurveSample[];
}

/** What an export's files hold, read once and kept until the files or choices change. */
export interface Scan {
  rows: number;
  /** Rows that couldn't be read, and are left out. */
  unreadable: number;
  firstAt: number | null;
  lastAt: number | null;
  firstMileage: { at: number; value: number } | null;
  lastMileage: { at: number; value: number } | null;
  drives: DriveSegment[];
  charges: ChargeSegment[];
  /** The account's saved places; not tied to dates, so offered whatever the range. */
  places: ImportPlace[];
  /** When each row with readings was taken, so a new date range needn't read the files again. */
  readingTimes: number[];
}

export interface Fix {
  lat: number;
  lon: number;
  speedKmh: number | null;
  altitudeM: number | null;
  bearing: number | null;
}

/** One moment of an export, as RivianMate would have recorded it live. */
export interface Reading {
  at: number;
  /** Rivian's field names, with only what the export has a value for. */
  state: VehicleState;
  /** Whether the vehicle was sending state then, so a heartbeat can be due. */
  reporting: boolean;
  fix: Fix | null;
}

/** The choices that decide what an export's files are read as. */
export interface ReadOptions {
  timeZone: string;
  /** The vehicle being imported to, for an export that holds several. */
  vin: string;
}

/** One kind of export the import can read. */
export interface ExportFormat {
  id: ImportFormat;
  /** A whole export comes as one file, so another upload replaces it. */
  singleFile: boolean;
  /** Says why an upload that isn't this kind of export can't be read. */
  unreadable: string;
  /**
   * Turns an upload into the file kept for import, or throws if it isn't
   * this kind of export. Returns the VINs it has data for, or null when it
   * doesn't say.
   */
  store(
    upload: string,
    stem: string,
    maxBytes: number,
  ): Promise<{ path: string; vins: string[] | null }>;
  /** Which of the choices the scan depends on. */
  scanKey(options: ReadOptions): string;
  scan(paths: readonly string[], options: ReadOptions): Promise<Scan>;
  /** The readings in time order, each once. */
  readings(paths: readonly string[], options: ReadOptions): AsyncIterable<Reading>;
  /** Every state field `readings` can hold. */
  stateFields: readonly string[];
  /** Repeats the last fix between new ones, speed included, so one that hasn't moved is dropped. */
  repeatsFixes: boolean;
}
