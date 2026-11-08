import { and, asc, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type {
  ImportBatchDto,
  ImportCounts,
  ImportDraftDto,
  ImportFormat,
  ImportPreviewDto,
  ImportSessionAddition,
  ImportSelection,
  ImportsDto,
} from '../../api-types.js';
import type { Db } from '../../db/client.js';
import {
  chargingCurvePoints,
  chargingSessions,
  drivers,
  drives,
  importBatches,
  importSessionFills,
  locationPoints,
  savedLocations,
  stateChanges,
  stateHeartbeats,
  tripActivities,
  vehicles,
} from '../../db/schema.js';
import { type Logger, silentLogger } from '../../logger.js';
import { isTeslaMateVehicle } from '../../teslamate/ids.js';
import type { VehicleState } from '../../rivian/types.js';
import { isListedDrive } from '../drive-metrics.js';
import { electraFiFormat } from '../electrafi/format.js';
import type { HistoryKeys } from '../history-keys.js';
import { MIN_MOVE_KM } from '../location-writer.js';
import {
  END_OF_TIME,
  HEARTBEAT_MS,
  type StateChange,
  StateDiff,
  changeRows,
  changesBetween,
  latestChanges,
} from '../state-history.js';
import { roamerFormat } from '../roamer/format.js';
import { haversineKm } from '../state-utils.js';
import {
  type ChargeSegment,
  type DriveSegment,
  type ExportFormat,
  type Fix,
  ImportError,
  type ReadOptions,
  type Reading,
  type Scan,
  capped,
} from './format.js';
import {
  type Existing,
  type Plan,
  type PlannedCharge,
  buildPlan,
  previewOf,
  rangeOf,
} from './plan.js';
import { isTimeZone } from './time-zone.js';

export { ImportError } from './format.js';

const TEMP_PREFIX = 'rivianmate-import-';
/**
 * Per file, as stored: a year of ElectraFi's minute-by-minute rows is about
 * 180 MB decompressed, and a Roamer archive stays compressed.
 */
export const MAX_FILE_BYTES = 1024 ** 3;
const MAX_FILES = 240;
const INSERT_BATCH = 1000;
const RESTARTED = 'RivianMate restarted during the import.';

const FORMATS: Readonly<Record<ImportFormat, ExportFormat>> = {
  electrafi: electraFiFormat,
  roamer: roamerFormat,
};

interface Draft {
  id: string;
  dir: string;
  format: ExportFormat;
  files: { name: string; path: string }[];
  /** The VINs the files have data for; null when they don't say. */
  vins: string[] | null;
  /** The files as last read: only they and the choices in its key change it, not the dates. */
  scan?: { key: string; scan: Scan };
}

function emptyCounts(): ImportCounts {
  return {
    drives: 0,
    sessions: 0,
    sessionsEnriched: 0,
    locationPoints: 0,
    stateChanges: 0,
  };
}

function toDto(row: typeof importBatches.$inferSelect, progress: number | null): ImportBatchDto {
  return {
    id: row.id,
    vehicleId: row.vehicleId,
    format: row.format,
    files: row.files,
    timeZone: row.timeZone,
    from: row.fromDate,
    to: row.toDate,
    status: row.status,
    counts: row.counts,
    progress,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

/**
 * Imports other apps' exports, one kind per upload. Files wait in a temp
 * folder between upload and import, and go when it's done; a restart loses
 * them along with any import under way.
 *
 * Writes go straight to the tables, not through the monitor: what happened
 * months ago mustn't send notifications or look like live state. What's
 * already stored always wins, and every added row carries the batch's id so
 * an import can be removed whole.
 */
export class Imports {
  private draft: Draft | null = null;
  /** The import under way (one at a time), and how far through its rows it is. */
  private running: { id: number; done: number; total: number } | null = null;
  private undoing = false;

  constructor(
    private readonly db: Db,
    private readonly keys: HistoryKeys,
    private readonly log: Logger = silentLogger,
    private readonly onDrivesAdded: () => void = () => {},
    private readonly now: () => number = Date.now,
    private readonly maxFileBytes = MAX_FILE_BYTES,
    private readonly formats = FORMATS,
  ) {}

  /** After a restart: an import that was running is gone, and so are its temp files. */
  async recover(): Promise<void> {
    const left = await this.db
      .select({ id: importBatches.id })
      .from(importBatches)
      .where(eq(importBatches.status, 'running'));
    for (const { id } of left) await this.fail(id, RESTARTED);
    const temp = await readdir(tmpdir()).catch(() => [] as string[]);
    await Promise.all(
      temp
        .filter((name) => name.startsWith(TEMP_PREFIX))
        .map((name) =>
          rm(join(tmpdir(), name), { recursive: true, force: true }).catch(() => undefined),
        ),
    );
  }

  /** Stores an uploaded file, adding it to the waiting draft of the same kind of export. */
  async addFile(
    draftId: string | undefined,
    name: string,
    body: Readable,
    formatId: ImportFormat = 'electrafi',
  ): Promise<ImportDraftDto> {
    const format = this.formats[formatId];
    if (draftId && this.draft?.id !== draftId) {
      throw new ImportError('That upload has gone. Add the files again.', 404);
    }
    if (draftId && this.draft!.format !== format) {
      throw new ImportError('Add files from one kind of export at a time.');
    }
    if (draftId && format.singleFile) {
      throw new ImportError('This export is a single file. Choose it again to replace it.');
    }
    // A new upload replaces whatever was left waiting.
    if (!draftId) await this.discardDraft();
    const draft = (this.draft ??= {
      id: randomUUID(),
      dir: await mkdtemp(join(tmpdir(), TEMP_PREFIX)),
      format,
      files: [],
      vins: null,
    });
    if (draft.files.length >= MAX_FILES) throw new ImportError('Too many files for one import.');

    const stem = join(draft.dir, String(draft.files.length));
    let stored: { path: string; vins: string[] | null };
    try {
      await pipeline(body, capped(this.maxFileBytes), createWriteStream(`${stem}.upload`));
      stored = await format.store(`${stem}.upload`, stem, this.maxFileBytes);
    } catch (err) {
      // Nothing to wait for if this was the first file.
      if (draft.files.length === 0) await this.discardDraft();
      if (err instanceof ImportError) throw err;
      this.log.info({ err, format: format.id }, 'upload not readable');
      throw new ImportError(format.unreadable);
    } finally {
      await rm(`${stem}.upload`, { force: true });
    }
    draft.scan = undefined;
    draft.vins = stored.vins;
    draft.files.push({ name: basename(name).slice(0, 200) || 'export', path: stored.path });
    return this.draftDto(draft);
  }

  async discardDraft(id?: string): Promise<void> {
    const draft = this.draft;
    if (!draft || (id && draft.id !== id)) return;
    this.draft = null;
    await rm(draft.dir, { recursive: true, force: true });
  }

  private async draftDto(draft: Draft): Promise<ImportDraftDto> {
    const vins = draft.vins;
    const covered =
      vins &&
      (vins.length === 0
        ? []
        : await this.db
            .select({ id: vehicles.id })
            .from(vehicles)
            .where(inArray(vehicles.vin, vins)));
    return {
      id: draft.id,
      format: draft.format.id,
      files: draft.files.map((f) => f.name),
      vehicleIds: covered && covered.map((v) => v.id),
    };
  }

  private async requireSelection(
    draftId: string,
    selection: ImportSelection,
  ): Promise<{ draft: Draft; options: ReadOptions }> {
    const draft = this.draft;
    if (!draft || draft.id !== draftId || draft.files.length === 0) {
      throw new ImportError('That upload has gone. Add the files again.', 404);
    }
    if (!isTimeZone(selection.timeZone)) throw new ImportError('Choose a valid time zone.');
    if (selection.from > selection.to) throw new ImportError('The start date is after the end.');
    const [vehicle] = await this.db
      .select({ id: vehicles.id, vin: vehicles.vin })
      .from(vehicles)
      .where(eq(vehicles.id, selection.vehicleId));
    if (!vehicle || isTeslaMateVehicle(selection.vehicleId)) {
      throw new ImportError('Choose one of your Rivian vehicles.');
    }
    if (draft.vins && !draft.vins.includes(vehicle.vin)) {
      throw new ImportError('This export has no data for that vehicle.');
    }
    return { draft, options: { timeZone: selection.timeZone, vin: vehicle.vin } };
  }

  private async existing(vehicleId: string, seq: number): Promise<Existing> {
    const [beats, driveRows, sessionRows, mileage, places] = await Promise.all([
      this.db
        .select({ at: stateHeartbeats.at, importId: stateHeartbeats.importId })
        .from(stateHeartbeats)
        .where(eq(stateHeartbeats.vehicleSeq, seq))
        .orderBy(asc(stateHeartbeats.at)),
      this.db
        .select({ startedAt: drives.startedAt, endedAt: drives.endedAt })
        .from(drives)
        .where(eq(drives.vehicleId, vehicleId)),
      this.db
        .select({
          id: chargingSessions.id,
          startedAt: chargingSessions.startedAt,
          endedAt: chargingSessions.endedAt,
          importId: chargingSessions.importId,
        })
        .from(chargingSessions)
        .where(eq(chargingSessions.vehicleId, vehicleId)),
      changesBetween(this.db, vehicleId, ['vehicleMileage'], new Date(0), END_OF_TIME),
      this.db
        .select({
          lat: savedLocations.lat,
          lon: savedLocations.lon,
          radiusM: savedLocations.radiusM,
          isHome: savedLocations.isHome,
        })
        .from(savedLocations),
    ]);
    const live = beats.filter((b) => b.importId == null).at(-1);
    return {
      heartbeats: beats.map((b) => b.at.getTime()),
      lastLiveAt: live?.at.getTime() ?? null,
      drives: driveRows.map((d) => ({
        startedAt: d.startedAt.getTime(),
        endedAt: d.endedAt?.getTime() ?? null,
      })),
      sessions: sessionRows.map((s) => ({
        id: s.id,
        startedAt: s.startedAt.getTime(),
        endedAt: s.endedAt?.getTime() ?? null,
        imported: s.importId != null,
      })),
      mileage: mileage.flatMap((c) =>
        typeof c.value === 'number' ? [{ at: c.at, value: c.value }] : [],
      ),
      places,
    };
  }

  private async vehicleSeq(vehicleId: string): Promise<number> {
    const seq = await this.keys.vehicleSeq(vehicleId);
    if (seq === null) throw new ImportError('Choose one of your Rivian vehicles.');
    return seq;
  }

  async preview(draftId: string, selection: ImportSelection): Promise<ImportPreviewDto> {
    const { draft, options } = await this.requireSelection(draftId, selection);
    const scan = await this.scanOf(draft, options);
    const seq = await this.vehicleSeq(selection.vehicleId);
    const existing = await this.existing(selection.vehicleId, seq);
    const range = rangeOf(selection.from, selection.to, selection.timeZone);
    const plan = buildPlan(scan, existing, range, this.now());
    const counted = { readingsNew: 0, readingsRecorded: 0, readingsNewer: 0 };
    for (const at of scan.readingTimes) {
      if (plan.scope.includes(at)) counted.readingsNew += 1;
      else if (at < range.from || at >= range.to) continue;
      else if (existing.lastLiveAt != null && at > existing.lastLiveAt) counted.readingsNewer += 1;
      else counted.readingsRecorded += 1;
    }
    const bySession = new Map<number, ChargeSegment[]>();
    for (const { segment, sessionId } of plan.charges) {
      if (sessionId != null)
        bySession.set(sessionId, [...(bySession.get(sessionId) ?? []), segment]);
    }
    const additions = new Map(
      [...(await this.sessionAdditions(bySession))].map(([id, { fill, addCurve }]) => [
        id,
        additionsOf(fill, addCurve),
      ]),
    );
    return previewOf(scan, plan, existing, counted, {
      timeZone: selection.timeZone,
      now: this.now(),
      // As drives will be named once the places it adds are there.
      places: [...(await this.db.select().from(savedLocations)), ...plan.places],
      additions,
    });
  }

  private async scanOf(draft: Draft, options: ReadOptions): Promise<Scan> {
    const key = draft.format.scanKey(options);
    if (draft.scan?.key === key) return draft.scan.scan;
    const scan = await draft.format.scan(
      draft.files.map((f) => f.path),
      options,
    );
    draft.scan = { key, scan };
    return scan;
  }

  /** Starts importing in the background; follow it with `list`. */
  async start(draftId: string, selection: ImportSelection): Promise<ImportBatchDto> {
    if (this.running) throw new ImportError('An import is already running.', 409);
    if (this.undoing) throw new ImportError('An import is being undone. Try again shortly.', 409);
    const { draft, options } = await this.requireSelection(draftId, selection);
    const [batch] = await this.db
      .insert(importBatches)
      .values({
        vehicleId: selection.vehicleId,
        format: draft.format.id,
        files: draft.files.map((f) => f.name),
        timeZone: selection.timeZone,
        fromDate: selection.from,
        toDate: selection.to,
      })
      .returning();
    this.running = { id: batch!.id, done: 0, total: 0 };
    // The files now belong to the import.
    this.draft = null;
    void this.run(batch!.id, draft, selection, options);
    return toDto(batch!, 0);
  }

  /** Resolves once no import is running (for tests). */
  async idle(): Promise<void> {
    while (this.running) await new Promise((r) => setTimeout(r, 10));
  }

  private async run(
    id: number,
    draft: Draft,
    selection: ImportSelection,
    options: ReadOptions,
  ): Promise<void> {
    const format = draft.format.id;
    try {
      const scan = await this.scanOf(draft, options);
      if (this.running) this.running.total = scan.rows;
      const seq = await this.vehicleSeq(selection.vehicleId);
      const existing = await this.existing(selection.vehicleId, seq);
      const plan = buildPlan(
        scan,
        existing,
        rangeOf(selection.from, selection.to, selection.timeZone),
        this.now(),
      );
      const counts = await this.write(id, seq, selection.vehicleId, draft, options, plan);
      await this.db
        .update(importBatches)
        .set({ status: 'done', counts, finishedAt: new Date(this.now()) })
        .where(eq(importBatches.id, id));
      this.log.info({ batch: id, format, ...counts }, 'import finished');
      this.onDrivesAdded();
    } catch (err) {
      this.log.error({ err, batch: id, format }, 'import failed');
      await this.fail(id, 'The import failed and nothing was kept. See the logs for why.').catch(
        (cleanup: unknown) =>
          this.log.error({ err: cleanup, batch: id }, 'could not clean up a failed import'),
      );
    } finally {
      this.running = null;
      await rm(draft.dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async fail(id: number, error: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await removeImportedRows(tx as unknown as Db, id);
      await tx
        .update(importBatches)
        .set({ status: 'failed', error, finishedAt: new Date(this.now()) })
        .where(eq(importBatches.id, id));
    });
  }

  private async write(
    id: number,
    seq: number,
    vehicleId: string,
    draft: Draft,
    options: ReadOptions,
    plan: Plan,
  ): Promise<ImportCounts> {
    const counts = emptyCounts();
    const format = draft.format;
    if (plan.places.length > 0) {
      await this.db.insert(savedLocations).values(plan.places);
      counts.places = plan.places.length;
    }
    const driveIds = await this.insertDrives(id, vehicleId, plan);
    counts.drives = plan.drives.filter((d) => isListedDrive(d.distanceKm)).length;
    await this.writeCharges(id, vehicleId, format.id, plan.charges, counts);

    const writer = new RowWriter(this.db, this.keys, id, seq, vehicleId, driveIds, counts, format);
    const paths = draft.files.map((f) => f.path);
    for await (const reading of format.readings(paths, options)) {
      if (this.running) this.running.done += 1;
      if (plan.scope.includes(reading.at)) await writer.take(reading);
      else await writer.closeWindow();
    }
    await writer.closeWindow();

    // Held back until now: a lookup needs the drive's points, written above.
    if (plan.drives.length > 0) {
      await this.db
        .update(drives)
        .set({ placesCheckedAt: null, weatherCheckedAt: null })
        .where(eq(drives.importId, id));
    }
    return counts;
  }

  private async insertDrives(
    id: number,
    vehicleId: string,
    plan: Plan,
  ): Promise<{ id: number; startedAt: number; endedAt: number }[]> {
    const out: { id: number; startedAt: number; endedAt: number }[] = [];
    const heldBack = new Date(this.now());
    const driverOf = await this.driversByName(vehicleId, plan.drives);
    for (let i = 0; i < plan.drives.length; i += INSERT_BATCH) {
      const rows = await this.db
        .insert(drives)
        .values(
          plan.drives.slice(i, i + INSERT_BATCH).map((d) => ({
            vehicleId,
            importId: id,
            startedAt: new Date(d.startedAt),
            endedAt: new Date(d.endedAt),
            startLat: d.start.lat,
            startLon: d.start.lon,
            endLat: d.end.lat,
            endLon: d.end.lon,
            distanceKm: d.distanceKm,
            startMileageM: d.start.mileageM,
            endMileageM: d.end.mileageM,
            startBattery: d.start.battery,
            endBattery: d.end.battery,
            startRangeKm: d.start.rangeKm,
            endRangeKm: d.end.rangeKm,
            batteryCapacityKwh: d.batteryCapacityKwh,
            driveMode: d.driveMode,
            elevationGainM: d.elevationGainM,
            elevationLossM: d.elevationLossM,
            destinationName: d.destination?.name ?? null,
            destinationLat: d.destination?.lat ?? null,
            destinationLon: d.destination?.lon ?? null,
            ...driverOf(d.driverName),
            placesCheckedAt: heldBack,
            weatherCheckedAt: heldBack,
          })),
        )
        .returning({ id: drives.id, startedAt: drives.startedAt, endedAt: drives.endedAt });
      for (const r of rows) {
        out.push({ id: r.id, startedAt: r.startedAt.getTime(), endedAt: r.endedAt!.getTime() });
      }
    }
    return out.sort((a, b) => a.startedAt - b.startedAt);
  }

  /**
   * The driver for each name the drives give: the vehicle's driver by that
   * name (the user's or the one it reported), or else one made for it, with
   * no profile until the vehicle reports one by that name. A drive with no
   * name is left for the vehicle's profile, as a live one is.
   */
  private async driversByName(
    vehicleId: string,
    planned: readonly DriveSegment[],
  ): Promise<(name: string | null) => { driverId?: number; driverSource?: 'profile' }> {
    const key = (name: string) => name.trim().toLowerCase();
    const names = new Map(
      planned.flatMap((d) => (d.driverName ? [[key(d.driverName), d.driverName.trim()]] : [])),
    );
    const ids = new Map<string, number>();
    if (names.size > 0) {
      const known = await this.db
        .select({
          id: drivers.id,
          name: drivers.name,
          reportedName: drivers.reportedName,
          profileId: drivers.profileId,
        })
        .from(drivers)
        .where(eq(drivers.vehicleId, vehicleId))
        // A profile's driver first, so it wins over one made from a name.
        .orderBy(sql`${drivers.profileId} IS NULL`, asc(drivers.id));
      for (const driver of known) {
        for (const name of [driver.name, driver.reportedName]) {
          if (name && !ids.has(key(name))) ids.set(key(name), driver.id);
        }
      }
      const missing = [...names].filter(([k]) => !ids.has(k));
      if (missing.length > 0) {
        const made = await this.db
          .insert(drivers)
          .values(missing.map(([, name]) => ({ vehicleId, reportedName: name })))
          .returning({ id: drivers.id, reportedName: drivers.reportedName });
        for (const driver of made) ids.set(key(driver.reportedName!), driver.id);
      }
    }
    return (name) => {
      const driverId = name ? ids.get(key(name)) : undefined;
      return driverId == null ? {} : { driverId, driverSource: 'profile' };
    };
  }

  private async writeCharges(
    id: number,
    vehicleId: string,
    source: ImportFormat,
    charges: readonly PlannedCharge[],
    counts: ImportCounts,
  ): Promise<void> {
    const bySession = new Map<number, ChargeSegment[]>();
    for (const { segment, sessionId } of charges) {
      if (sessionId == null) {
        // Recorded too: Rivian's history can merge into this session and keep it past an undo.
        const created = await this.db.transaction(async (tx) => {
          const [row] = await tx
            .insert(chargingSessions)
            .values({
              vehicleId,
              importId: id,
              source,
              startedAt: new Date(segment.startedAt),
              endedAt: new Date(segment.endedAt),
              chargingSeconds: segment.chargingSeconds,
              startSoc: segment.startSoc,
              endSoc: segment.endSoc,
              energyKwh: segment.energyKwh,
              packKwh: segment.packKwh,
              thermalKwh: segment.thermalKwh,
              rangeAddedKm: segment.rangeAddedKm,
              avgPowerKw: segment.avgPowerKw,
              maxPowerKw: segment.maxPowerKw,
              lat: segment.lat,
              lon: segment.lon,
            })
            .returning();
          const fields = storedFields(
            row!,
            SESSION_FIGURES.filter((field) => row![field] != null),
          );
          await tx.insert(importSessionFills).values({ importId: id, sessionId: row!.id, fields });
          return row!;
        });
        await this.insertCurve(id, created.id, source, segment);
        counts.sessions += 1;
      } else {
        bySession.set(sessionId, [...(bySession.get(sessionId) ?? []), segment]);
      }
    }
    if (bySession.size === 0) return;

    for (const [sessionId, { fill, addCurve }] of await this.sessionAdditions(bySession)) {
      const hasFill = Object.keys(fill).length > 0;
      if (hasFill) await this.fillSession(id, sessionId, fill);
      if (addCurve) {
        for (const segment of bySession.get(sessionId)!) {
          await this.insertCurve(id, sessionId, source, segment);
        }
      }
      if (hasFill || addCurve) counts.sessionsEnriched += 1;
    }
  }

  /** Fills a session's blanks and records what went in, together, for undo. */
  private async fillSession(id: number, sessionId: number, fill: SessionFill): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [filled] = await tx
        .update(chargingSessions)
        .set(fill)
        .where(eq(chargingSessions.id, sessionId))
        .returning();
      if (!filled) return;
      const fields = storedFields(filled, Object.keys(fill));
      await tx.insert(importSessionFills).values({ importId: id, sessionId, fields });
    });
  }

  /** What each existing session is missing that its charges can give it. */
  private async sessionAdditions(
    bySession: ReadonlyMap<number, readonly ChargeSegment[]>,
  ): Promise<Map<number, { fill: SessionFill; addCurve: boolean }>> {
    const out = new Map<number, { fill: SessionFill; addCurve: boolean }>();
    const ids = [...bySession.keys()];
    if (ids.length === 0) return out;
    const [rows, curves] = await Promise.all([
      this.db.select().from(chargingSessions).where(inArray(chargingSessions.id, ids)),
      this.db
        .selectDistinct({ id: chargingCurvePoints.sessionId })
        .from(chargingCurvePoints)
        .where(
          and(
            inArray(chargingCurvePoints.sessionId, ids),
            ne(chargingCurvePoints.source, 'forecast'),
          ),
        ),
    ]);
    const withCurve = new Set(curves.map((r) => r.id));
    for (const row of rows) {
      const segments = bySession.get(row.id)!;
      out.set(row.id, {
        fill: fillFor(row, segments),
        addCurve: !withCurve.has(row.id) && segments.some((s) => s.curve.length > 0),
      });
    }
    return out;
  }

  private async insertCurve(
    id: number,
    sessionId: number,
    source: ImportFormat,
    segment: ChargeSegment,
  ): Promise<void> {
    for (let i = 0; i < segment.curve.length; i += INSERT_BATCH) {
      await this.db
        .insert(chargingCurvePoints)
        .values(
          segment.curve.slice(i, i + INSERT_BATCH).map((p) => ({
            sessionId,
            importId: id,
            source,
            ts: new Date(p.at),
            powerKw: p.powerKw,
            soc: p.soc,
          })),
        )
        .onConflictDoNothing();
    }
  }

  /** Removes an import and everything it added, and blanks what it filled on existing sessions. */
  async undo(id: number): Promise<void> {
    // A running import decided what to skip from what's stored, this import's rows included.
    if (this.running) throw new ImportError('Wait for the running import to finish.', 409);
    this.undoing = true;
    try {
      await this.db.transaction(async (tx) => {
        await removeImportedRows(tx as unknown as Db, id);
        await tx.delete(importBatches).where(eq(importBatches.id, id));
      });
    } finally {
      this.undoing = false;
    }
  }

  async list(): Promise<ImportsDto> {
    const rows = await this.db
      .select()
      .from(importBatches)
      .orderBy(desc(importBatches.createdAt), desc(importBatches.id));
    return {
      draft: this.draft && (await this.draftDto(this.draft)),
      batches: rows.map((row) => {
        const running = this.running?.id === row.id ? this.running : null;
        return toDto(
          row,
          running ? (running.total > 0 ? Math.min(1, running.done / running.total) : 0) : null,
        );
      }),
    };
  }
}

type SessionFill = Partial<typeof chargingSessions.$inferInsert>;

/** The figures an import can write to a session. */
const SESSION_FIGURES = [
  'chargingSeconds',
  'startSoc',
  'endSoc',
  'energyKwh',
  'packKwh',
  'thermalKwh',
  'rangeAddedKm',
  'avgPowerKw',
  'maxPowerKw',
  'lat',
  'lon',
] as const;

/** As stored, so undo compares like with like. */
function storedFields(
  row: typeof chargingSessions.$inferSelect,
  fields: readonly string[],
): Record<string, number> {
  return Object.fromEntries(fields.map((f) => [f, row[f as keyof typeof row] as number]));
}

function additionsOf(fill: SessionFill, addCurve: boolean): ImportSessionAddition[] {
  const adds: ImportSessionAddition[] = [];
  if (fill.chargingSeconds != null) adds.push('chargingTime');
  if (fill.startSoc != null || fill.endSoc != null) adds.push('batteryLevels');
  if (fill.energyKwh != null) adds.push('energy');
  if (fill.packKwh != null || fill.thermalKwh != null) adds.push('breakdown');
  if (fill.rangeAddedKm != null) adds.push('range');
  if (fill.avgPowerKw != null || fill.maxPowerKw != null) adds.push('power');
  if (fill.lat != null) adds.push('location');
  if (addCurve) adds.push('curve');
  return adds;
}

/** Only what's blank on the session: what it already has is better than an export's. */
function fillFor(
  row: typeof chargingSessions.$inferSelect,
  segments: readonly ChargeSegment[],
): SessionFill {
  const seconds = segments.reduce((sum, s) => sum + s.chargingSeconds, 0);
  const sum = (pick: (s: ChargeSegment) => number | null) => {
    const values = segments.map(pick).filter((v): v is number => v != null);
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) : null;
  };
  const powered = segments.filter((s) => s.avgPowerKw != null);
  const poweredSeconds = powered.reduce((total, s) => total + s.chargingSeconds, 0);
  const candidates: SessionFill = {
    chargingSeconds: row.chargingSeconds == null && seconds > 0 ? seconds : null,
    startSoc: row.startSoc == null ? segments[0]!.startSoc : null,
    endSoc: row.endSoc == null ? segments.at(-1)!.endSoc : null,
    energyKwh: row.energyKwh == null ? sum((s) => s.energyKwh) : null,
    packKwh: row.packKwh == null ? sum((s) => s.packKwh) : null,
    thermalKwh: row.thermalKwh == null ? sum((s) => s.thermalKwh) : null,
    rangeAddedKm: row.rangeAddedKm == null ? sum((s) => s.rangeAddedKm) : null,
    avgPowerKw:
      row.avgPowerKw == null && poweredSeconds > 0
        ? powered.reduce((total, s) => total + s.avgPowerKw! * s.chargingSeconds, 0) /
          poweredSeconds
        : null,
    maxPowerKw:
      row.maxPowerKw == null && segments.some((s) => s.maxPowerKw != null)
        ? Math.max(...segments.map((s) => s.maxPowerKw ?? 0))
        : null,
    lat: row.lat == null ? segments[0]!.lat : null,
    lon: row.lon == null ? segments[0]!.lon : null,
  };
  return Object.fromEntries(Object.entries(candidates).filter(([, v]) => v != null));
}

/**
 * Blanks what a batch filled on existing sessions, unless it has changed since.
 * A field another import also filled stays until that one goes too.
 */
async function restoreFilledSessions(db: Db, id: number): Promise<void> {
  const fills = await db
    .select()
    .from(importSessionFills)
    .where(eq(importSessionFills.importId, id));
  if (fills.length === 0) return;
  const sessionIds = fills.map((f) => f.sessionId);
  const [rows, others] = await Promise.all([
    db.select().from(chargingSessions).where(inArray(chargingSessions.id, sessionIds)),
    db
      .select()
      .from(importSessionFills)
      .where(
        and(inArray(importSessionFills.sessionId, sessionIds), ne(importSessionFills.importId, id)),
      ),
  ]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const { sessionId, fields } of fills) {
    const row = byId.get(sessionId);
    if (!row) continue;
    const claimed = others
      .filter((o) => o.sessionId === sessionId)
      .flatMap((o) => Object.keys(o.fields));
    const blanks = Object.entries(fields)
      .filter(
        ([field, value]) => row[field as keyof typeof row] === value && !claimed.includes(field),
      )
      .map(([field]) => [field, null]);
    if (blanks.length === 0) continue;
    await db
      .update(chargingSessions)
      .set(Object.fromEntries(blanks) as SessionFill)
      .where(eq(chargingSessions.id, sessionId));
  }
  await db.delete(importSessionFills).where(eq(importSessionFills.importId, id));
}

/**
 * Everything a batch added. A session Rivian's history has since merged into
 * stays as Rivian's: its next sync fills what the import's figures leave blank.
 */
async function removeImportedRows(db: Db, id: number): Promise<void> {
  await restoreFilledSessions(db, id);
  const imported = db.select({ id: drives.id }).from(drives).where(eq(drives.importId, id));
  // A late live fix can have landed on an imported drive.
  await db
    .update(locationPoints)
    .set({ driveId: null })
    .where(inArray(locationPoints.driveId, imported));
  await db.delete(locationPoints).where(eq(locationPoints.importId, id));
  await db.delete(stateChanges).where(eq(stateChanges.importId, id));
  await db.delete(stateHeartbeats).where(eq(stateHeartbeats.importId, id));
  await db.delete(chargingCurvePoints).where(eq(chargingCurvePoints.importId, id));
  await db
    .update(chargingSessions)
    .set({
      importId: null,
      source: 'rivian',
      // A city only the import's location looked up goes with it.
      city: sql`CASE WHEN ${chargingSessions.placesCheckedAt} IS NULL THEN ${chargingSessions.city} END`,
      placesCheckedAt: null,
    })
    .where(
      and(
        eq(chargingSessions.importId, id),
        sql`${chargingSessions.rivianTransactionId} IS NOT NULL`,
      ),
    );
  // Trips lose what's going; a session kept above stays in its trip.
  await db.delete(tripActivities).where(
    and(
      // Ids are per source, so a TeslaMate activity can share one.
      inArray(
        tripActivities.vehicleId,
        db
          .select({ id: importBatches.vehicleId })
          .from(importBatches)
          .where(eq(importBatches.id, id)),
      ),
      or(
        and(
          eq(tripActivities.kind, 'charge'),
          inArray(
            tripActivities.activityId,
            db
              .select({ id: chargingSessions.id })
              .from(chargingSessions)
              .where(eq(chargingSessions.importId, id)),
          ),
        ),
        and(eq(tripActivities.kind, 'drive'), inArray(tripActivities.activityId, imported)),
      ),
    ),
  );
  await db.delete(chargingSessions).where(eq(chargingSessions.importId, id));
  await db.delete(drives).where(eq(drives.importId, id));
}

/**
 * Writes the readings an import takes. A window is a run of them with nothing
 * skipped between; state in it records only real changes from what was held
 * when it opened, and when it closes, whatever RivianMate last recorded is
 * put back, so the import doesn't change what history shows afterwards.
 */
class RowWriter {
  private window: { diff: StateDiff; wrote: boolean; lastAt: number } | null = null;
  private changes: StateChange[] = [];
  private points: (typeof locationPoints.$inferInsert)[] = [];
  private beats: (typeof stateHeartbeats.$inferInsert)[] = [];
  private lastPoint: { lat: number; lon: number } | null = null;
  private lastBeatAt = -Infinity;
  private driveIndex = 0;

  constructor(
    private readonly db: Db,
    private readonly keys: HistoryKeys,
    private readonly id: number,
    private readonly seq: number,
    private readonly vehicleId: string,
    private readonly driveList: readonly { id: number; startedAt: number; endedAt: number }[],
    private readonly counts: ImportCounts,
    private readonly format: ExportFormat,
  ) {}

  async take({ at, state, reporting, fix }: Reading): Promise<void> {
    if (!this.window) {
      const fields = this.format.stateFields;
      const held = await latestChanges(this.db, this.vehicleId, fields, new Date(at));
      this.window = {
        diff: new StateDiff(new Map(held.map((c) => [c.field, c.value]))),
        wrote: false,
        lastAt: at,
      };
    }
    const window = this.window;
    window.lastAt = at;
    const changes = window.diff.changes(state, at);
    if (changes.length > 0) {
      window.wrote = true;
      this.changes.push(...changes);
    }
    if (reporting && at - this.lastBeatAt >= HEARTBEAT_MS) {
      this.lastBeatAt = at;
      this.beats.push({ vehicleSeq: this.seq, at: new Date(at), importId: this.id });
    }
    if (fix) this.takePoint(fix, at);
    if (
      this.changes.length >= INSERT_BATCH ||
      this.points.length >= INSERT_BATCH ||
      this.beats.length >= INSERT_BATCH
    ) {
      await this.flush();
    }
  }

  private takePoint(fix: Fix, at: number): void {
    const { lat, lon } = fix;
    const last = this.lastPoint;
    // As live: a fix that hasn't moved is kept only while moving, unless the export repeats them.
    if (
      last &&
      haversineKm(last.lat, last.lon, lat, lon) < MIN_MOVE_KM &&
      (this.format.repeatsFixes || (fix.speedKmh ?? 0) <= 0)
    ) {
      return;
    }
    this.lastPoint = { lat, lon };
    this.points.push({
      vehicleId: this.vehicleId,
      ts: new Date(at),
      lat,
      lon,
      speedKmh: fix.speedKmh,
      bearing: fix.bearing,
      altitude: fix.altitudeM,
      driveId: this.driveAt(at),
      importId: this.id,
    });
  }

  /** Rows come in order, so the drive only ever moves forward. */
  private driveAt(at: number): number | null {
    while (
      this.driveIndex < this.driveList.length &&
      this.driveList[this.driveIndex]!.endedAt < at
    ) {
      this.driveIndex += 1;
    }
    const drive = this.driveList[this.driveIndex];
    return drive && drive.startedAt <= at ? drive.id : null;
  }

  async closeWindow(): Promise<void> {
    const window = this.window;
    if (!window) return;
    this.window = null;
    await this.flush();
    if (!window.wrote) return;
    const until = new Date(window.lastAt);
    const held = await liveValues(this.db, this.seq, until, this.format.stateFields);
    // A moment after the last row, so it isn't taken for that row's reading.
    const closeAt = window.lastAt + 1000;
    const state: VehicleState = {};
    for (const [field, value] of held) {
      state[field] = { value, timeStamp: new Date(closeAt).toISOString() };
    }
    this.changes.push(...window.diff.changes(state, closeAt));
    await this.flush();
  }

  private async flush(): Promise<void> {
    if (this.changes.length > 0) {
      const rows = await changeRows(this.keys, this.seq, this.changes);
      this.changes = [];
      for (let i = 0; i < rows.length; i += INSERT_BATCH) {
        const written = await this.db
          .insert(stateChanges)
          .values(rows.slice(i, i + INSERT_BATCH).map((r) => ({ ...r, importId: this.id })))
          .onConflictDoNothing()
          .returning({ at: stateChanges.at });
        this.counts.stateChanges += written.length;
      }
    }
    if (this.points.length > 0) {
      const written = await this.db
        .insert(locationPoints)
        .values(this.points)
        .onConflictDoNothing()
        .returning({ ts: locationPoints.ts });
      this.counts.locationPoints += written.length;
      this.points = [];
    }
    if (this.beats.length > 0) {
      await this.db.insert(stateHeartbeats).values(this.beats).onConflictDoNothing();
      this.beats = [];
    }
  }
}

/** Each field's latest value at `at`, ignoring imports. */
async function liveValues(
  db: Db,
  seq: number,
  at: Date,
  fields: readonly string[],
): Promise<Map<string, string | number | null>> {
  const rows = await db.execute<{ field: string; num: number | null; value: string | null }>(sql`
    SELECT f.name AS field, c.num, c.value
    FROM state_fields f
    CROSS JOIN LATERAL (
      SELECT num, value FROM state_changes
      WHERE vehicle_seq = ${seq} AND field_id = f.id AND import_id IS NULL
        AND at <= ${at.toISOString()}::timestamptz
      ORDER BY at DESC LIMIT 1
    ) c
    WHERE f.name IN (${sql.join(
      fields.map((f) => sql`${f}`),
      sql`, `,
    )})
  `);
  return new Map(rows.map((r) => [r.field, r.num ?? r.value]));
}
