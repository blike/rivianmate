import { createReadStream, createWriteStream } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import {
  type ExportFormat,
  ImportError,
  type Reading,
  type Scan,
  capped,
} from '../imports/format.js';
import {
  type ElectraFiRow,
  NotAnExportError,
  ROW_STATE_FIELDS,
  firstDataId,
  readRows,
  rowState,
} from './parse.js';
import { ChargeSegmenter, DriveSegmenter } from './segment.js';

async function isGzip(path: string): Promise<boolean> {
  const file = await open(path, 'r');
  try {
    const { bytesRead, buffer } = await file.read(Buffer.alloc(2), 0, 2, 0);
    return bytesRead === 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
  } finally {
    await file.close();
  }
}

export async function scanFiles(paths: readonly string[], timeZone: string): Promise<Scan> {
  const scan: Scan = {
    rows: 0,
    unreadable: 0,
    firstAt: null,
    lastAt: null,
    firstMileage: null,
    lastMileage: null,
    drives: [],
    charges: [],
    places: [],
    readingTimes: [],
  };
  const driveFinder = new DriveSegmenter();
  const chargeFinder = new ChargeSegmenter();
  for await (const { row, at } of readRows(paths, timeZone, scan)) {
    scan.rows += 1;
    scan.firstAt = Math.min(scan.firstAt ?? at, at);
    scan.lastAt = Math.max(scan.lastAt ?? at, at);
    if (row.mileageM != null) {
      const reading = { at, value: row.mileageM };
      scan.firstMileage ??= reading;
      scan.lastMileage = reading;
      scan.readingTimes.push(at);
    }
    scan.drives.push(...driveFinder.push(row, at));
    scan.charges.push(...chargeFinder.push(row, at));
  }
  scan.drives.push(...driveFinder.flush());
  scan.charges.push(...chargeFinder.flush());
  return scan;
}

export function readingOf(row: ElectraFiRow, at: number): Reading {
  return {
    at,
    state: rowState(row, at),
    // Asleep rows have no state in them, and a sleeping car sends no heartbeats live either.
    reporting: row.mileageM != null,
    fix:
      row.lat != null && row.lon != null
        ? {
            lat: row.lat,
            lon: row.lon,
            speedKmh: row.speedKmh,
            altitudeM: row.altitudeM,
            bearing: null,
          }
        : null,
  };
}

/** ElectraFi's CSV exports: one account per car, with local times and no zone. */
export const electraFiFormat: ExportFormat = {
  id: 'electrafi',
  singleFile: false,
  unreadable: "Couldn't read this file as an ElectraFi export.",

  async store(upload, stem, maxBytes) {
    const path = `${stem}.csv`;
    try {
      const stored = createWriteStream(path);
      const uploaded = createReadStream(upload);
      if (await isGzip(upload)) {
        await pipeline(uploaded, createGunzip(), capped(maxBytes), stored);
      } else {
        await pipeline(uploaded, stored);
      }
      // Reads the header and first row, so a wrong file is refused here.
      await firstDataId(path);
    } catch (err) {
      await rm(path, { force: true });
      if (err instanceof NotAnExportError) throw new ImportError(err.message);
      throw err;
    }
    return { path, vins: null };
  },

  scanKey: ({ timeZone }) => timeZone,
  scan: (paths, { timeZone }) => scanFiles(paths, timeZone),

  async *readings(paths, { timeZone }) {
    for await (const { row, at } of readRows(paths, timeZone)) yield readingOf(row, at);
  },

  stateFields: ROW_STATE_FIELDS,
  repeatsFixes: true,
};
