/**
 * One-time replay of the archived battery-state payloads into state changes, so
 * the cell temperatures (and the cold-limit verdict) have history from before the
 * decoder existed.
 *
 * The archive holds every distinct payload of every topic for good, which is
 * exactly what this needs: the frames were stored months before anyone read
 * temperatures out of them, and the live mapping and guard are reused unchanged,
 * so a replayed reading becomes the row the live recorder would have written.
 *
 * Replayed rows land on the same `(vehicle_seq, field_id, at)` the live path
 * writes — both stamp with the message's own time — so a replay after the live
 * recorder has been running collides rather than duplicates. The one exception is
 * a frame whose message carried no timestamp at all: then the archive stored the
 * arrival time and the live path its own clock, so the two can differ by a
 * millisecond and record the same reading twice.
 */
import { and, eq, inArray, min } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  appSettings,
  parallaxArchive,
  parallaxChunks,
  stateChanges,
  stateFields,
  vehicles,
} from '../db/schema.js';
import type { Logger } from '../logger.js';
import {
  BATTERY_THERMAL_FIELDS,
  RVM_BATTERY_STATE,
  batteryState,
  decodeBatteryState,
} from '../rivian/parallax/domains/energy.js';
import type { HistoryKeys } from './history-keys.js';
import type { ParallaxArchive } from './parallax-archive.js';
import { type StateChange, StateDiff, changeRows, latestChanges } from './state-history.js';

/** `app_settings` key holding `{"after":{"<vehicleId>":"<ISO>"}}`. */
export const CURSOR_KEY = 'cell_temp_backfill';
/** Archive window per read, in hours: `messages()` loads every chunk in its range into memory. */
export const WINDOW_HOURS = 6;
const INSERT_BATCH = 2000;
/** Windows between progress lines: a day's worth at the default size. */
const PROGRESS_EVERY = 4;

export interface CellTempBackfillDeps {
  db: Db;
  keys: HistoryKeys;
  archive: ParallaxArchive;
  log: Logger;
}

export interface CellTempBackfillOptions {
  /** Default: every stored vehicle. */
  vehicleId?: string;
  /** Default: the cursor for that vehicle, else the oldest archived payload. */
  from?: Date;
  /** Default: now. */
  to?: Date;
  /**
   * Count what a run would consider writing, without writing anything. An upper
   * bound: rows already recorded are counted here, since checking each against the
   * table would cost a query per change.
   */
  dryRun?: boolean;
  /** Archive window per read, in hours. Default 6. */
  batchHours?: number;
  /** Ignore the cursor and replay the range from `from`: for re-reading after a guard change. */
  reset?: boolean;
}

export interface CellTempBackfillResult {
  /** Archived payloads read. */
  payloads: number;
  /** State rows inserted; rows already there are left alone. */
  rows: number;
  /** Vehicles that contributed at least one row. */
  vehicles: number;
}

interface Cursor {
  after: Record<string, string>;
}

async function readCursor(db: Db): Promise<Record<string, string>> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, CURSOR_KEY));
  if (!row) return {};
  try {
    const after = (JSON.parse(row.value) as Partial<Cursor>).after;
    if (typeof after === 'string') return { '*': after }; // the first shape: one vehicle
    return after ?? {};
  } catch {
    return {};
  }
}

async function writeCursor(
  tx: Db | Parameters<Parameters<Db['transaction']>[0]>[0],
  vehicleId: string,
  at: Date,
): Promise<void> {
  const after = { ...(await readCursor(tx as Db)), [vehicleId]: at.toISOString() };
  const value = JSON.stringify({ after } satisfies Cursor);
  await tx
    .insert(appSettings)
    .values({ key: CURSOR_KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } });
}

/**
 * A diff seeded from what is already recorded, so a resume does not re-record a
 * value that has not moved. In a dry run, seeding must not register the field
 * names (that is a write), so it only seeds when they already exist.
 */
async function seededDiff(
  db: Db,
  vehicleId: string,
  at: Date,
  dryRun: boolean,
): Promise<StateDiff> {
  if (dryRun) {
    const present = await db
      .select({ name: stateFields.name })
      .from(stateFields)
      .where(inArray(stateFields.name, [...BATTERY_THERMAL_FIELDS]));
    if (present.length < BATTERY_THERMAL_FIELDS.length) return new StateDiff();
  }
  const known = new Map(
    (await latestChanges(db, vehicleId, BATTERY_THERMAL_FIELDS, at)).map((c) => [c.field, c.value]),
  );
  return new StateDiff(known);
}

/** The oldest battery-state payload the archive holds, rows or rolled-up chunks. */
async function archiveStart(db: Db, seq: number, topicId: number): Promise<Date | null> {
  const [row] = await db
    .select({ at: min(parallaxArchive.at) })
    .from(parallaxArchive)
    .where(and(eq(parallaxArchive.vehicleSeq, seq), eq(parallaxArchive.topicId, topicId)));
  const [chunk] = await db
    .select({ hour: min(parallaxChunks.hour) })
    .from(parallaxChunks)
    .where(and(eq(parallaxChunks.vehicleSeq, seq), eq(parallaxChunks.topicId, topicId)));
  const times = [row?.at, chunk?.hour].filter((d): d is Date => d instanceof Date);
  return times.length > 0 ? new Date(Math.min(...times.map((d) => d.getTime()))) : null;
}

/**
 * Replays the archive's battery-state payloads through the live path's own mapping
 * and guard, writing the changes as state rows. Resumable per vehicle: each
 * window's rows are idempotent and a cursor records how far each vehicle got.
 */
export async function backfillCellTemps(
  deps: CellTempBackfillDeps,
  options: CellTempBackfillOptions = {},
): Promise<CellTempBackfillResult> {
  const { db, keys, archive, log } = deps;
  if (options.reset && !options.dryRun) {
    await db.delete(appSettings).where(eq(appSettings.key, CURSOR_KEY));
  }
  const to = options.to ?? new Date();
  const windowMs = Math.max(1, Math.round(options.batchHours ?? WINDOW_HOURS)) * 3600_000;
  const targets = options.vehicleId
    ? [{ id: options.vehicleId }]
    : await db.select({ id: vehicles.id }).from(vehicles);
  const cursors = options.reset ? {} : await readCursor(db);
  const topicId = (await keys.topicIds([RVM_BATTERY_STATE], false)).get(RVM_BATTERY_STATE);

  let payloads = 0;
  let rows = 0;
  let contributed = 0;

  for (const target of targets) {
    const seq = await keys.vehicleSeq(target.id);
    if (seq === null) {
      if (options.vehicleId) throw new Error(`no such vehicle: ${target.id}`);
      continue;
    }
    if (topicId === undefined) break; // nothing of this topic was ever archived
    const cursor = cursors[target.id] ?? cursors['*'];
    const start =
      options.from ?? (cursor ? new Date(cursor) : await archiveStart(db, seq, topicId));
    if (start === null || start >= to) continue;

    // Seeded from what is already recorded: a re-stamped reading is not a change.
    const diff = await seededDiff(db, target.id, start, Boolean(options.dryRun));
    let perVehiclePayloads = 0;
    let wrote = 0;
    let progress = 0;

    for (let from = start.getTime(); from < to.getTime(); from += windowMs) {
      const end = new Date(Math.min(from + windowMs, to.getTime()));
      const messages = await archive.messages(target.id, RVM_BATTERY_STATE, new Date(from), end);
      const changes: StateChange[] = [];
      for (const message of messages) {
        // The archive read is closed at both ends, so a payload on a window
        // boundary would be read twice; the final window keeps its edge.
        if (message.at.getTime() === from && from !== start.getTime()) continue;
        perVehiclePayloads += 1;
        const battery = decodeBatteryState(message.payload);
        if (!battery) continue;
        // The live mapping, not a copy of it: whatever `toState` records, the replay records.
        const state = batteryState.toState!(battery, message.at.toISOString());
        changes.push(...diff.changes(state, message.at.getTime(), BATTERY_THERMAL_FIELDS));
      }

      if (options.dryRun) {
        // Counting only: no rows, and no `state_fields` rows either.
        const distinct = new Set(changes.map((c) => `${c.field}|${c.at}`));
        rows += distinct.size;
        wrote += distinct.size;
      } else if (changes.length > 0) {
        const values = await changeRows(keys, seq, changes);
        await db.transaction(async (tx) => {
          for (let i = 0; i < values.length; i += INSERT_BATCH) {
            const inserted = await tx
              .insert(stateChanges)
              .values(values.slice(i, i + INSERT_BATCH))
              .onConflictDoNothing()
              .returning({ at: stateChanges.at });
            rows += inserted.length;
            wrote += inserted.length;
          }
          await writeCursor(tx, target.id, end);
        });
      } else {
        await writeCursor(db, target.id, end);
      }

      progress += 1;
      if (progress % PROGRESS_EVERY === 0) {
        log.info(
          `cell temperatures: ${target.id} reached ${new Date(from).toISOString()} (${wrote} rows so far)`,
        );
      }
    }

    payloads += perVehiclePayloads;
    if (wrote > 0) contributed += 1;
    log.info(
      `cell temperatures: ${target.id} ${wrote} state rows from ${perVehiclePayloads} payloads`,
    );
  }

  return { payloads, rows, vehicles: contributed };
}
