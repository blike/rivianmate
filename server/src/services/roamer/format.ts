import { rename, rm } from 'node:fs/promises';
import {
  type ChargeSegment,
  type Destination,
  type ExportFormat,
  type ImportPlace,
  ImportError,
  type Reading,
  type Scan,
} from '../imports/format.js';
import { NotARoamerExportError, RoamerArchive } from './archive.js';
import {
  METRIC_STATE_FIELDS,
  chargeOf,
  chargingPower,
  destinationsFor,
  driveOf,
  fixOf,
  instant,
  metricState,
  navigationOf,
  num,
  placeOf,
} from './parse.js';

/** The export's vehicles, by Roamer's id for each. */
async function vehiclesOf(archive: RoamerArchive): Promise<{ id: string; vin: string }[]> {
  const out: { id: string; vin: string }[] = [];
  for await (const record of archive.records(archive.files('vehicles'))) {
    const { id, vin } = record;
    if (typeof id === 'string' && typeof vin === 'string') out.push({ id, vin });
  }
  return out;
}

/** The account's saved places, Home marked by Roamer's favourite for it. */
async function placesOf(archive: RoamerArchive): Promise<ImportPlace[]> {
  const homes = new Set<unknown>();
  for await (const record of archive.records(archive.files('rivian_favorites'))) {
    if (record['key'] === 'home') homes.add(record['tagged_location_id']);
  }
  const places: ImportPlace[] = [];
  for await (const record of archive.records(archive.files('saved_places'))) {
    const place = placeOf(record, homes.has(record['id']));
    if (place) places.push(place);
  }
  return places;
}

/** Opens the archive at the folder of the vehicle with this VIN. */
async function openFor(
  paths: readonly string[],
  vin: string,
): Promise<{ archive: RoamerArchive; vehicleId: string }> {
  const archive = await RoamerArchive.open(paths[0]!);
  const vehicle = (await vehiclesOf(archive)).find((v) => v.vin === vin);
  if (!vehicle) {
    archive.close();
    throw new ImportError('This export has no data for that vehicle.');
  }
  return { archive, vehicleId: vehicle.id };
}

/** Walks forward through charges in time order, for readings that come in time order too. */
class ChargeCursor {
  private index = 0;

  constructor(private readonly charges: readonly ChargeSegment[]) {}

  at(at: number): ChargeSegment | null {
    while (this.index < this.charges.length && this.charges[this.index]!.endedAt < at) {
      this.index += 1;
    }
    const charge = this.charges[this.index];
    return charge && charge.startedAt <= at ? charge : null;
  }
}

const byStart = (a: { startedAt: number }, b: { startedAt: number }) => a.startedAt - b.startedAt;

/**
 * Drives and charges are Roamer's own sessions. The metrics fill in what
 * they don't keep: the capacity a drive set off with, where its navigation
 * was headed, and the battery level through each charge for its curve.
 */
async function scanArchive(archive: RoamerArchive, vehicleId: string): Promise<Scan> {
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
  const seen = (at: number) => {
    scan.firstAt = Math.min(scan.firstAt ?? at, at);
    scan.lastAt = Math.max(scan.lastAt ?? at, at);
  };
  for await (const record of archive.records(archive.files('drive_sessions', vehicleId), scan)) {
    const drive = driveOf(record);
    if (drive) scan.drives.push(drive);
  }
  for await (const record of archive.records(archive.files('charging_sessions', vehicleId), scan)) {
    const charge = chargeOf(record);
    if (charge) scan.charges.push(charge);
  }
  scan.drives.sort(byStart);
  scan.charges.sort(byStart);
  const navigation: { at: number; to: Destination | null }[] = [];
  for await (const record of archive.records(archive.files('navigation_metrics', vehicleId))) {
    const reading = navigationOf(record);
    if (reading) navigation.push(reading);
  }
  navigation.sort((a, b) => a.at - b.at);
  destinationsFor(scan.drives, navigation).forEach((to, i) => {
    scan.drives[i]!.destination = to;
  });
  scan.places = await placesOf(archive);
  for (const s of [...scan.drives, ...scan.charges]) {
    seen(s.startedAt);
    seen(s.endedAt);
  }

  // The battery level through each charge, in time order.
  const levels = new Map<ChargeSegment, { at: number; value: number }[]>();
  const charging = new ChargeCursor(scan.charges);
  let capacity: number | null = null;
  let nextDrive = 0;
  for await (const record of archive.records(archive.files('vehicle_metrics', vehicleId), scan)) {
    const at = instant(record['created_at']);
    if (at == null) {
      scan.unreadable += 1;
      continue;
    }
    scan.rows += 1;
    seen(at);
    while (nextDrive < scan.drives.length && scan.drives[nextDrive]!.startedAt <= at) {
      scan.drives[nextDrive]!.batteryCapacityKwh = capacity;
      nextDrive += 1;
    }
    if (Object.keys(metricState(record, at)).length > 0) scan.readingTimes.push(at);
    const mileage = num(record['vehicle_mileage']);
    if (mileage != null) {
      scan.firstMileage ??= { at, value: mileage };
      scan.lastMileage = { at, value: mileage };
    }
    capacity = num(record['battery_capacity']) ?? capacity;
    const level = num(record['battery_level']);
    const charge = level == null ? null : charging.at(at);
    if (charge) {
      const through = levels.get(charge) ?? [];
      through.push({ at, value: level! });
      levels.set(charge, through);
    }
  }
  for (const drive of scan.drives.slice(nextDrive)) drive.batteryCapacityKwh = capacity;

  for await (const record of archive.records(archive.files('location_metrics', vehicleId), scan)) {
    const at = instant(record['created_at']);
    if (at == null) {
      scan.unreadable += 1;
      continue;
    }
    scan.rows += 1;
    seen(at);
  }

  const curving = new ChargeCursor(scan.charges);
  const levelIndex = new Map<ChargeSegment, number>();
  for await (const record of archive.records(archive.files('charging_metrics', vehicleId), scan)) {
    const at = instant(record['created_at']);
    const powerKw = chargingPower(record);
    const charge = at == null || powerKw == null ? null : curving.at(at);
    if (!charge) continue;
    // The latest level at or before the sample; before the first, where the charge began.
    const known = levels.get(charge) ?? [];
    let i = levelIndex.get(charge) ?? -1;
    while (i + 1 < known.length && known[i + 1]!.at <= at!) i += 1;
    levelIndex.set(charge, i);
    charge.curve.push({ at: at!, powerKw, soc: known[i]?.value ?? charge.startSoc });
  }
  return scan;
}

/** The vehicle's metrics and fixes as readings, merged into time order. */
async function* readingsOf(archive: RoamerArchive, vehicleId: string): AsyncGenerator<Reading> {
  async function* states(): AsyncGenerator<Reading> {
    for await (const record of archive.records(archive.files('vehicle_metrics', vehicleId))) {
      const at = instant(record['created_at']);
      if (at != null) yield { at, state: metricState(record, at), reporting: true, fix: null };
    }
  }
  async function* fixes(): AsyncGenerator<Reading> {
    for await (const record of archive.records(archive.files('location_metrics', vehicleId))) {
      const at = instant(record['created_at']);
      if (at != null) yield { at, state: {}, reporting: false, fix: fixOf(record) };
    }
  }
  yield* byTime(states(), fixes());
}

/** Merges streams that are each in time order. */
async function* byTime(...sources: AsyncGenerator<Reading>[]): AsyncGenerator<Reading> {
  const heads = await Promise.all(sources.map((s) => s.next()));
  try {
    for (;;) {
      let pick = -1;
      heads.forEach((head, i) => {
        if (!head.done && (pick < 0 || head.value.at < (heads[pick]!.value as Reading).at)) {
          pick = i;
        }
      });
      if (pick < 0) return;
      yield heads[pick]!.value as Reading;
      heads[pick] = await sources[pick]!.next();
    }
  } finally {
    await Promise.all(sources.map((s) => s.return(undefined)));
  }
}

/** Roamer's data export: one zip for the account, with exact times and each vehicle's VIN. */
export const roamerFormat: ExportFormat = {
  id: 'roamer',
  singleFile: true,
  unreadable: "Couldn't read this file as a Rivian Roamer export.",

  async store(upload, stem) {
    const path = `${stem}.zip`;
    await rename(upload, path);
    try {
      const archive = await RoamerArchive.open(path);
      try {
        return { path, vins: (await vehiclesOf(archive)).map((v) => v.vin) };
      } finally {
        archive.close();
      }
    } catch (err) {
      await rm(path, { force: true });
      if (err instanceof NotARoamerExportError) throw new ImportError(err.message);
      throw err;
    }
  },

  // Times are exact, so the zone only sets where the chosen dates fall.
  scanKey: ({ vin }) => vin,

  async scan(paths, { vin }) {
    const { archive, vehicleId } = await openFor(paths, vin);
    try {
      return await scanArchive(archive, vehicleId);
    } finally {
      archive.close();
    }
  },

  async *readings(paths, { vin }) {
    const { archive, vehicleId } = await openFor(paths, vin);
    try {
      yield* readingsOf(archive, vehicleId);
    } finally {
      archive.close();
    }
  },

  stateFields: METRIC_STATE_FIELDS,
  repeatsFixes: false,
};
