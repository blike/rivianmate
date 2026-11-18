import { and, eq, min } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  appSettings,
  parallaxArchive,
  parallaxChunks,
  stateChanges,
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

/** `app_settings` key: `{"after":{"<vehicleId>":"<ISO>"}}` while running, `{"done":true}` after. */
export const BACKFILL_KEY = 'cell_temp_backfill';
/** `archive.messages()` loads every chunk in its range into memory, so read a few hours at a time. */
const WINDOW_MS = 6 * 3600_000;
/** Rows per insert, well under Postgres's limit on query parameters. */
const INSERT_BATCH = 2000;

export interface CellTempBackfillDeps {
  db: Db;
  keys: HistoryKeys;
  archive: ParallaxArchive;
  log: Logger;
}

interface Progress {
  done?: boolean;
  after?: Record<string, string>;
}

async function readProgress(db: Db): Promise<Progress> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, BACKFILL_KEY));
  try {
    return row ? (JSON.parse(row.value) as Progress) : {};
  } catch {
    return {};
  }
}

async function writeProgress(db: Pick<Db, 'insert'>, progress: Progress): Promise<void> {
  const value = JSON.stringify(progress);
  await db
    .insert(appSettings)
    .values({ key: BACKFILL_KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } });
}

/** The oldest battery-state payload archived for a vehicle, as rows or rolled-up chunks. */
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
 * Once per install, replays the archived battery-state payloads up to `until`
 * into state history, so cell temperatures and the cold-limit verdict have a
 * history from before they were recorded. Payloads go through the live path's
 * own mapping and deadbands, and rows land on the message's own timestamp, so
 * anything the live recorder has already written is skipped rather than
 * duplicated. Resumes per vehicle after a restart. Returns null once done.
 */
export async function backfillCellTemps(
  deps: CellTempBackfillDeps,
  until: Date,
): Promise<{ payloads: number; rows: number } | null> {
  const { db, keys, archive, log } = deps;
  const progress = await readProgress(db);
  if (progress.done) return null;
  const after = { ...progress.after };
  const topicId = (await keys.topicIds([RVM_BATTERY_STATE], false)).get(RVM_BATTERY_STATE);
  let payloads = 0;
  let rows = 0;

  for (const { id } of topicId === undefined
    ? []
    : await db.select({ id: vehicles.id }).from(vehicles)) {
    const seq = await keys.vehicleSeq(id);
    if (seq === null) continue;
    const start = after[id] ? new Date(after[id]) : await archiveStart(db, seq, topicId!);
    if (start === null || start >= until) continue;

    // Seeded from what is already recorded, so a resumed run doesn't record an unmoved value again.
    const known = await latestChanges(db, id, BATTERY_THERMAL_FIELDS, start);
    const diff = new StateDiff(new Map(known.map((c) => [c.field, c.value])));

    for (let from = start.getTime(); from < until.getTime(); from += WINDOW_MS) {
      const end = new Date(Math.min(from + WINDOW_MS, until.getTime()));
      const changes: StateChange[] = [];
      for (const message of await archive.messages(id, RVM_BATTERY_STATE, new Date(from), end)) {
        // Both ends of the read are inclusive: the previous window already had this one.
        if (message.at.getTime() === from && from !== start.getTime()) continue;
        payloads += 1;
        const battery = decodeBatteryState(message.payload);
        if (!battery) continue;
        const state = batteryState.toState!(battery, message.at.toISOString());
        changes.push(...diff.changes(state, message.at.getTime(), BATTERY_THERMAL_FIELDS));
      }
      const values = await changeRows(keys, seq, changes);
      after[id] = end.toISOString();
      await db.transaction(async (tx) => {
        for (let i = 0; i < values.length; i += INSERT_BATCH) {
          const inserted = await tx
            .insert(stateChanges)
            .values(values.slice(i, i + INSERT_BATCH))
            .onConflictDoNothing()
            .returning({ at: stateChanges.at });
          rows += inserted.length;
        }
        await writeProgress(tx, { after });
      });
    }
  }

  await writeProgress(db, { done: true });
  log.info(`replayed ${payloads} archived battery payloads into ${rows} cell temperature rows`);
  return { payloads, rows };
}
