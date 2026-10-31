import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, open, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import type {
  ImportBatchDto,
  ImportCounts,
  ImportDraftDto,
  ImportPreviewDto,
  ImportSessionAddition,
  ImportSelection,
  ImportsDto,
} from '../../api-types.js';
import type { Db } from '../../db/client.js';
import {
  chargingCurvePoints,
  chargingSessions,
  drives,
  importBatches,
  locationPoints,
  savedLocations,
  stateChanges,
  stateHeartbeats,
  vehicles,
} from '../../db/schema.js';
import { type Logger, silentLogger } from '../../logger.js';
import { isTeslaMateVehicle } from '../../teslamate/ids.js';
import type { VehicleState } from '../../rivian/types.js';
import { isListedDrive } from '../drive-metrics.js';
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
import { haversineKm } from '../state-utils.js';
import {
  type ElectraFiRow,
  ROW_STATE_FIELDS,
  firstDataId,
  isTimeZone,
  readRows,
  rowState,
} from './parse.js';
import {
  type Existing,
  type Plan,
  type PlannedCharge,
  type Scan,
  buildPlan,
  previewOf,
  rangeOf,
  scanFiles,
} from './plan.js';
import type { ChargeSegment } from './segment.js';

const TEMP_PREFIX = 'rivianmate-import-';
/** Decompressed, per file; a year of minute-by-minute rows is about 180 MB. */
export const MAX_FILE_BYTES = 1024 ** 3;
const MAX_FILES = 240;
const INSERT_BATCH = 1000;
const RESTARTED = 'RivianMate restarted during the import.';

/** Something the user can act on; the route answers with its message. */
export class ImportError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

interface Draft {
  id: string;
  dir: string;
  files: { name: string; path: string }[];
  /** The files as last read: only they and the time zone change it, not the dates. */
  scan?: { timeZone: string; scan: Scan };
}

/** Stops a stream past `limit` bytes, so a small gzip can't fill the disk. */
function capped(limit: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      seen += chunk.length;
      if (seen > limit) done(new ImportError('This file is too large to import.', 413));
      else done(null, chunk);
    },
  });
}

async function isGzip(path: string): Promise<boolean> {
  const file = await open(path, 'r');
  try {
    const { bytesRead, buffer } = await file.read(Buffer.alloc(2), 0, 2, 0);
    return bytesRead === 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
  } finally {
    await file.close();
  }
}

function emptyCounts(): ImportCounts {
  return { drives: 0, sessions: 0, sessionsEnriched: 0, locationPoints: 0, stateChanges: 0 };
}

function toDto(row: typeof importBatches.$inferSelect, progress: number | null): ImportBatchDto {
  return {
    id: row.id,
    vehicleId: row.vehicleId,
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
 * Imports ElectraFi exports (one account per car, so the owner says which
 * car). Files wait in a temp folder between upload and import, and go when
 * it's done; a restart loses them along with any import under way.
 *
 * Writes go straight to the tables, not through the monitor: what happened
 * months ago mustn't send notifications or look like live state. What's
 * already stored always wins, and every added row carries the batch's id so
 * an import can be removed whole.
 */
export class ElectraFiImports {
  private draft: Draft | null = null;
  /** The import under way (one at a time), and how far through its rows it is. */
  private running: { id: number; done: number; total: number } | null = null;

  constructor(
    private readonly db: Db,
    private readonly keys: HistoryKeys,
    private readonly log: Logger = silentLogger,
    private readonly onDrivesAdded: () => void = () => {},
    private readonly now: () => number = Date.now,
    private readonly maxFileBytes = MAX_FILE_BYTES,
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

  /** Stores an uploaded file, as sent or gzipped, adding it to the waiting draft. */
  async addFile(
    draftId: string | undefined,
    name: string,
    body: Readable,
  ): Promise<ImportDraftDto> {
    if (draftId && this.draft?.id !== draftId) {
      throw new ImportError('That upload has gone. Add the files again.', 404);
    }
    // A new upload replaces whatever was left waiting.
    if (!draftId) await this.discardDraft();
    const draft = (this.draft ??= {
      id: randomUUID(),
      dir: await mkdtemp(join(tmpdir(), TEMP_PREFIX)),
      files: [],
    });
    if (draft.files.length >= MAX_FILES) throw new ImportError('Too many files for one import.');

    const stem = join(draft.dir, String(draft.files.length));
    const path = `${stem}.csv`;
    try {
      await pipeline(body, capped(this.maxFileBytes), createWriteStream(`${stem}.upload`));
      const stored = createWriteStream(path);
      const uploaded = createReadStream(`${stem}.upload`);
      if (await isGzip(`${stem}.upload`)) {
        await pipeline(uploaded, createGunzip(), capped(this.maxFileBytes), stored);
      } else {
        await pipeline(uploaded, stored);
      }
      // Reads the header and first row, so a wrong file is refused here.
      await firstDataId(path);
    } catch (err) {
      await rm(path, { force: true });
      // Nothing to wait for if this was the first file.
      if (draft.files.length === 0) await this.discardDraft();
      if (err instanceof ImportError) throw err;
      throw new ImportError(
        err instanceof Error && err.message.includes('ElectraFi')
          ? err.message
          : "Couldn't read this file as an ElectraFi export.",
      );
    } finally {
      await rm(`${stem}.upload`, { force: true });
    }
    draft.scan = undefined;
    draft.files.push({ name: basename(name).slice(0, 200) || 'export.csv', path });
    return this.draftDto(draft);
  }

  async discardDraft(id?: string): Promise<void> {
    const draft = this.draft;
    if (!draft || (id && draft.id !== id)) return;
    this.draft = null;
    await rm(draft.dir, { recursive: true, force: true });
  }

  private draftDto(draft: Draft): ImportDraftDto {
    return { id: draft.id, files: draft.files.map((f) => f.name) };
  }

  private async requireSelection(draftId: string, selection: ImportSelection): Promise<Draft> {
    const draft = this.draft;
    if (!draft || draft.id !== draftId || draft.files.length === 0) {
      throw new ImportError('That upload has gone. Add the files again.', 404);
    }
    if (!isTimeZone(selection.timeZone)) throw new ImportError('Choose a valid time zone.');
    if (selection.from > selection.to) throw new ImportError('The start date is after the end.');
    const [vehicle] = await this.db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(eq(vehicles.id, selection.vehicleId));
    if (!vehicle || isTeslaMateVehicle(selection.vehicleId)) {
      throw new ImportError('Choose one of your Rivian vehicles.');
    }
    return draft;
  }

  private async existing(vehicleId: string, seq: number): Promise<Existing> {
    const [beats, driveRows, sessionRows, mileage] = await Promise.all([
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
    };
  }

  private async vehicleSeq(vehicleId: string): Promise<number> {
    const seq = await this.keys.vehicleSeq(vehicleId);
    if (seq === null) throw new ImportError('Choose one of your Rivian vehicles.');
    return seq;
  }

  async preview(draftId: string, selection: ImportSelection): Promise<ImportPreviewDto> {
    const draft = await this.requireSelection(draftId, selection);
    const scan = await this.scanOf(draft, selection.timeZone);
    const seq = await this.vehicleSeq(selection.vehicleId);
    const existing = await this.existing(selection.vehicleId, seq);
    const range = rangeOf(selection.from, selection.to, selection.timeZone);
    const plan = buildPlan(scan, existing, range, this.now());
    const counted = { readingsNew: 0, readingsRecorded: 0 };
    for (const at of scan.readingTimes) {
      if (plan.scope.includes(at)) counted.readingsNew += 1;
      else if (at >= range.from && at < range.to) counted.readingsRecorded += 1;
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
      places: await this.db.select().from(savedLocations),
      additions,
    });
  }

  private async scanOf(draft: Draft, timeZone: string): Promise<Scan> {
    if (draft.scan?.timeZone === timeZone) return draft.scan.scan;
    const scan = await scanFiles(
      draft.files.map((f) => f.path),
      timeZone,
    );
    draft.scan = { timeZone, scan };
    return scan;
  }

  /** Starts importing in the background; follow it with `list`. */
  async start(draftId: string, selection: ImportSelection): Promise<ImportBatchDto> {
    if (this.running) throw new ImportError('An import is already running.', 409);
    const draft = await this.requireSelection(draftId, selection);
    const [batch] = await this.db
      .insert(importBatches)
      .values({
        vehicleId: selection.vehicleId,
        files: draft.files.map((f) => f.name),
        timeZone: selection.timeZone,
        fromDate: selection.from,
        toDate: selection.to,
      })
      .returning();
    this.running = { id: batch!.id, done: 0, total: 0 };
    // The files now belong to the import.
    this.draft = null;
    void this.run(batch!.id, draft, selection);
    return toDto(batch!, 0);
  }

  /** Resolves once no import is running (for tests). */
  async idle(): Promise<void> {
    while (this.running) await new Promise((r) => setTimeout(r, 10));
  }

  private async run(id: number, draft: Draft, selection: ImportSelection): Promise<void> {
    try {
      const paths = draft.files.map((f) => f.path);
      const scan = await this.scanOf(draft, selection.timeZone);
      if (this.running) this.running.total = scan.rows;
      const seq = await this.vehicleSeq(selection.vehicleId);
      const existing = await this.existing(selection.vehicleId, seq);
      const plan = buildPlan(
        scan,
        existing,
        rangeOf(selection.from, selection.to, selection.timeZone),
        this.now(),
      );
      const counts = await this.write(id, seq, selection, paths, plan);
      await this.db
        .update(importBatches)
        .set({ status: 'done', counts, finishedAt: new Date(this.now()) })
        .where(eq(importBatches.id, id));
      this.log.info({ batch: id, ...counts }, 'ElectraFi import finished');
      this.onDrivesAdded();
    } catch (err) {
      this.log.error({ err, batch: id }, 'ElectraFi import failed');
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
    selection: ImportSelection,
    paths: readonly string[],
    plan: Plan,
  ): Promise<ImportCounts> {
    const counts = emptyCounts();
    const driveIds = await this.insertDrives(id, selection.vehicleId, plan);
    counts.drives = plan.drives.filter((d) => isListedDrive(d.distanceKm)).length;
    await this.writeCharges(id, selection.vehicleId, plan.charges, counts);

    const writer = new RowWriter(
      this.db,
      this.keys,
      id,
      seq,
      selection.vehicleId,
      driveIds,
      counts,
    );
    for await (const { row, at } of readRows(paths, selection.timeZone)) {
      if (this.running) this.running.done += 1;
      if (plan.scope.includes(at)) await writer.take(row, at);
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

  private async writeCharges(
    id: number,
    vehicleId: string,
    charges: readonly PlannedCharge[],
    counts: ImportCounts,
  ): Promise<void> {
    const bySession = new Map<number, ChargeSegment[]>();
    for (const { segment, sessionId } of charges) {
      if (sessionId == null) {
        const [created] = await this.db
          .insert(chargingSessions)
          .values({
            vehicleId,
            importId: id,
            source: 'electrafi',
            startedAt: new Date(segment.startedAt),
            endedAt: new Date(segment.endedAt),
            chargingSeconds: segment.chargingSeconds,
            startSoc: segment.startSoc,
            endSoc: segment.endSoc,
            energyKwh: segment.energyKwh,
            rangeAddedKm: segment.rangeAddedKm,
            avgPowerKw: segment.avgPowerKw,
            maxPowerKw: segment.maxPowerKw,
            lat: segment.lat,
            lon: segment.lon,
          })
          .returning({ id: chargingSessions.id });
        await this.insertCurve(id, created!.id, segment);
        counts.sessions += 1;
      } else {
        bySession.set(sessionId, [...(bySession.get(sessionId) ?? []), segment]);
      }
    }
    if (bySession.size === 0) return;

    for (const [sessionId, { fill, addCurve }] of await this.sessionAdditions(bySession)) {
      const hasFill = Object.keys(fill).length > 0;
      if (hasFill) {
        await this.db.update(chargingSessions).set(fill).where(eq(chargingSessions.id, sessionId));
      }
      if (addCurve) {
        for (const segment of bySession.get(sessionId)!) {
          await this.insertCurve(id, sessionId, segment);
        }
      }
      if (hasFill || addCurve) counts.sessionsEnriched += 1;
    }
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

  private async insertCurve(id: number, sessionId: number, segment: ChargeSegment): Promise<void> {
    for (let i = 0; i < segment.curve.length; i += INSERT_BATCH) {
      await this.db
        .insert(chargingCurvePoints)
        .values(
          segment.curve.slice(i, i + INSERT_BATCH).map((p) => ({
            sessionId,
            importId: id,
            source: 'electrafi' as const,
            ts: new Date(p.at),
            powerKw: p.powerKw,
            soc: p.soc,
          })),
        )
        .onConflictDoNothing();
    }
  }

  /** Removes an import and everything it added. Blanks it filled on existing sessions stay. */
  async undo(id: number): Promise<void> {
    if (this.running?.id === id) throw new ImportError("That import hasn't finished yet.", 409);
    await this.db.transaction(async (tx) => {
      await removeImportedRows(tx as unknown as Db, id);
      await tx.delete(importBatches).where(eq(importBatches.id, id));
    });
  }

  async list(): Promise<ImportsDto> {
    const rows = await this.db
      .select()
      .from(importBatches)
      .orderBy(desc(importBatches.createdAt), desc(importBatches.id));
    return {
      draft: this.draft && this.draftDto(this.draft),
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

function additionsOf(fill: SessionFill, addCurve: boolean): ImportSessionAddition[] {
  const adds: ImportSessionAddition[] = [];
  if (fill.chargingSeconds != null) adds.push('chargingTime');
  if (fill.startSoc != null || fill.endSoc != null) adds.push('batteryLevels');
  if (fill.energyKwh != null) adds.push('energy');
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

/** Everything a batch added, except a session Rivian's history has since merged into. */
async function removeImportedRows(db: Db, id: number): Promise<void> {
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
    .set({ importId: null })
    .where(
      and(
        eq(chargingSessions.importId, id),
        sql`${chargingSessions.rivianTransactionId} IS NOT NULL`,
      ),
    );
  await db.delete(chargingSessions).where(eq(chargingSessions.importId, id));
  await db.delete(drives).where(eq(drives.importId, id));
}

/**
 * Writes the rows an import takes. A window is a run of them with nothing
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
  ) {}

  async take(row: ElectraFiRow, at: number): Promise<void> {
    if (!this.window) {
      const held = await latestChanges(this.db, this.vehicleId, ROW_STATE_FIELDS, new Date(at));
      this.window = {
        diff: new StateDiff(new Map(held.map((c) => [c.field, c.value]))),
        wrote: false,
        lastAt: at,
      };
    }
    const window = this.window;
    window.lastAt = at;
    const changes = window.diff.changes(rowState(row, at), at);
    if (changes.length > 0) {
      window.wrote = true;
      this.changes.push(...changes);
    }
    // Asleep rows have no state in them, and a sleeping car sends no heartbeats live either.
    if (row.mileageM != null && at - this.lastBeatAt >= HEARTBEAT_MS) {
      this.lastBeatAt = at;
      this.beats.push({ vehicleSeq: this.seq, at: new Date(at), importId: this.id });
    }
    if (row.lat != null && row.lon != null) this.takePoint(row, at);
    if (
      this.changes.length >= INSERT_BATCH ||
      this.points.length >= INSERT_BATCH ||
      this.beats.length >= INSERT_BATCH
    ) {
      await this.flush();
    }
  }

  private takePoint(row: ElectraFiRow, at: number): void {
    const lat = row.lat!;
    const lon = row.lon!;
    const last = this.lastPoint;
    // Exports repeat the last fix between new ones, speed included.
    if (last && haversineKm(last.lat, last.lon, lat, lon) < MIN_MOVE_KM) return;
    this.lastPoint = { lat, lon };
    this.points.push({
      vehicleId: this.vehicleId,
      ts: new Date(at),
      lat,
      lon,
      speedKmh: row.speedKmh,
      altitude: row.altitudeM,
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
    const held = await liveValues(this.db, this.seq, until);
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
      ROW_STATE_FIELDS.map((f) => sql`${f}`),
      sql`, `,
    )})
  `);
  return new Map(rows.map((r) => [r.field, r.num ?? r.value]));
}
