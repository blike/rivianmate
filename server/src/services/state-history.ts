import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { stateChanges, stateHeartbeats } from '../db/schema.js';
import type { TimeStampedValue, VehicleState } from '../rivian/types.js';
import type { HistoryKeys } from './history-keys.js';

/**
 * Fields not recorded: GPS is kept per fix in location_points, and the
 * cloud connection is live status, re-stamped on every sync.
 */
const UNRECORDED_FIELDS = new Set([
  'gnssLocation',
  'gnssSpeed',
  'gnssBearing',
  'gnssAltitude',
  'cloudConnection',
]);
/**
 * Fields whose readings jitter below what they mean: a change is recorded
 * once it's this far from the last recorded value, in the field's unit.
 * Rivian's capacity estimate moves by hundredths of a kWh every few seconds
 * while driving. Tire pressures (bar) bounce 0.005 between the feeds, legacy
 * rounding to 0.01 (3.03) and Parallax to 0.025 (3.025).
 */
const DEADBANDS: Readonly<Record<string, number>> = {
  batteryCapacity: 0.1,
  tirePressureFrontLeft: 0.01,
  tirePressureFrontRight: 0.01,
  tirePressureRearLeft: 0.01,
  tirePressureRearRight: 0.01,
};
/** Float slack, so a step of exactly a deadband (3.04 to 3.05) still counts. */
const DEADBAND_EPSILON = 1e-9;
/** Heartbeats are at least this far apart. */
export const HEARTBEAT_MS = 15 * 60_000;

type Value = string | number | null;

export interface StateChange {
  field: string;
  /** Rivian's time for the reading (ms). */
  at: number;
  value: Value;
}

interface PerVehicle {
  seq: number | null;
  diff: StateDiff;
  lastHeartbeatAt: number;
}

/**
 * Which readings are changes worth recording: a value that differs from
 * the field's last recorded one (by more than its deadband, for a number).
 */
export class StateDiff {
  constructor(private readonly last = new Map<string, Value>()) {}

  /**
   * The changes among a state's fields (all of them by default), each at
   * its own stamp, or `fallbackAt` for one without a usable stamp.
   */
  changes(
    state: VehicleState,
    fallbackAt: number,
    fields: readonly string[] = Object.keys(state),
  ): StateChange[] {
    return readingsOf(state, fields, fallbackAt).filter((r) => {
      if (this.last.has(r.field) && !changed(r.field, this.last.get(r.field)!, r.value)) {
        return false;
      }
      this.last.set(r.field, r.value);
      return true;
    });
  }
}

/** History rows for changes; a field changed twice under one stamp keeps its last value. */
export async function changeRows(
  keys: HistoryKeys,
  vehicleSeq: number,
  changes: readonly StateChange[],
): Promise<(typeof stateChanges.$inferInsert)[]> {
  const ids = await keys.fieldIds(changes.map((c) => c.field));
  const rows = new Map<string, typeof stateChanges.$inferInsert>();
  for (const c of changes) {
    rows.set(`${c.field}|${c.at}`, {
      vehicleSeq,
      fieldId: ids.get(c.field)!,
      at: new Date(c.at),
      ...columnsOf(c.value),
    });
  }
  return [...rows.values()];
}

/**
 * Records vehicle state history as each field's changes of value, at
 * Rivian's time for it, plus a heartbeat every 15 minutes while state is
 * arriving. A reading that only re-stamps a value isn't a change. Each
 * vehicle's last values are loaded from what's recorded before its first
 * write, so a restart doesn't record them again.
 *
 * Calls for a vehicle are handled one at a time, in order.
 */
export class StateHistoryRecorder {
  private perVehicle = new Map<string, Promise<PerVehicle>>();
  private queues = new Map<string, Promise<void>>();

  constructor(
    private readonly db: Db,
    private readonly keys: HistoryKeys,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * The given fields of a state, as they are now. Values are read before
   * returning, so later changes to `state` don't affect what's recorded.
   */
  record(vehicleId: string, state: VehicleState, fields: readonly string[]): Promise<void> {
    const snapshot = Object.fromEntries(fields.map((f) => [f, state[f]])) as VehicleState;
    const seenAt = this.now();
    const run = (this.queues.get(vehicleId) ?? Promise.resolve()).then(() =>
      this.write(vehicleId, snapshot, seenAt),
    );
    this.queues.set(
      vehicleId,
      run.catch(() => {}),
    );
    return run;
  }

  private async write(vehicleId: string, state: VehicleState, seenAt: number): Promise<void> {
    const pv = await this.load(vehicleId);
    if (pv.seq === null) return;
    const changes = pv.diff.changes(state, seenAt);
    if (changes.length > 0) {
      await this.db
        .insert(stateChanges)
        .values(await changeRows(this.keys, pv.seq, changes))
        .onConflictDoUpdate({
          target: [stateChanges.vehicleSeq, stateChanges.fieldId, stateChanges.at],
          set: { num: sql`excluded.num`, value: sql`excluded.value` },
        });
    }
    if (seenAt - pv.lastHeartbeatAt >= HEARTBEAT_MS) {
      pv.lastHeartbeatAt = seenAt;
      await this.db
        .insert(stateHeartbeats)
        .values({ vehicleSeq: pv.seq, at: new Date(seenAt) })
        .onConflictDoNothing();
    }
  }

  private load(vehicleId: string): Promise<PerVehicle> {
    let pv = this.perVehicle.get(vehicleId);
    if (!pv) {
      pv = (async () => {
        const seq = await this.keys.vehicleSeq(vehicleId);
        const last = new Map<string, Value>();
        if (seq !== null) {
          for (const c of await latestChanges(this.db, vehicleId, null, null)) {
            last.set(c.field, c.value);
          }
        }
        return { seq, diff: new StateDiff(last), lastHeartbeatAt: 0 };
      })();
      // A vehicle stored later (or a failed load) is looked up again.
      pv.then(
        (v) => v.seq === null && this.perVehicle.delete(vehicleId),
        () => this.perVehicle.delete(vehicleId),
      );
      this.perVehicle.set(vehicleId, pv);
    }
    return pv;
  }
}

function readingsOf(
  state: VehicleState,
  fields: readonly string[],
  fallbackAt: number,
): StateChange[] {
  const readings: StateChange[] = [];
  for (const field of fields) {
    if (UNRECORDED_FIELDS.has(field)) continue;
    const record = state[field] as TimeStampedValue | undefined;
    if (!record || typeof record !== 'object' || !('value' in record)) continue;
    const { value } = record;
    if (value !== null && typeof value !== 'string' && typeof value !== 'number') continue;
    if (typeof value === 'number' && !Number.isFinite(value)) continue;
    const at = Date.parse(record.timeStamp);
    readings.push({ field, at: Number.isFinite(at) ? at : fallbackAt, value });
  }
  return readings;
}

/** Whether a reading differs from the last recorded value by enough to record. */
function changed(field: string, last: Value, value: Value): boolean {
  if (typeof last === 'number' && typeof value === 'number') {
    const band = DEADBANDS[field];
    return band == null ? value !== last : Math.abs(value - last) >= band - DEADBAND_EPSILON;
  }
  return last !== value;
}

function columnsOf(value: Value): { num: number | null; value: string | null } {
  return typeof value === 'number' ? { num: value, value: null } : { num: null, value };
}

interface ChangeRow extends Record<string, unknown> {
  field: string;
  at: string | Date;
  num: number | null;
  value: string | null;
}

function toChange(row: ChangeRow): StateChange {
  return { field: row.field, at: new Date(row.at).getTime(), value: row.num ?? row.value };
}

const seqOf = (vehicleId: string) => sql`(SELECT seq FROM vehicles WHERE id = ${vehicleId})`;

function fieldFilter(fields: readonly string[] | null) {
  return fields
    ? sql`f.name IN (${sql.join(
        fields.map((f) => sql`${f}`),
        sql`, `,
      )})`
    : sql`TRUE`;
}

/** Each field's latest change at or before `at` (null for the latest of all). */
export async function latestChanges(
  db: Db,
  vehicleId: string,
  fields: readonly string[] | null,
  at: Date | null,
): Promise<StateChange[]> {
  if (fields?.length === 0) return [];
  const rows = await db.execute<ChangeRow>(sql`
    SELECT f.name AS field, c.at, c.num, c.value
    FROM state_fields f
    CROSS JOIN LATERAL (
      SELECT at, num, value FROM state_changes
      WHERE vehicle_seq = ${seqOf(vehicleId)} AND field_id = f.id
        ${at ? sql`AND at <= ${at.toISOString()}::timestamptz` : sql``}
      ORDER BY at DESC LIMIT 1
    ) c
    WHERE ${fieldFilter(fields)}
  `);
  return rows.map(toChange);
}

/** A numeric field's latest recorded value, or null. */
export async function latestNumber(
  db: Db,
  vehicleId: string,
  field: string,
): Promise<number | null> {
  const [latest] = await latestChanges(db, vehicleId, [field], null);
  return typeof latest?.value === 'number' ? latest.value : null;
}

/** The fields' changes after `from` up to `to`, in time order. */
export async function changesBetween(
  db: Db,
  vehicleId: string,
  fields: readonly string[],
  from: Date,
  to: Date,
): Promise<StateChange[]> {
  if (fields.length === 0) return [];
  const rows = await db.execute<ChangeRow>(sql`
    SELECT f.name AS field, c.at, c.num, c.value
    FROM state_changes c JOIN state_fields f ON f.id = c.field_id
    WHERE c.vehicle_seq = ${seqOf(vehicleId)} AND ${fieldFilter(fields)}
      AND c.at > ${from.toISOString()}::timestamptz AND c.at <= ${to.toISOString()}::timestamptz
    ORDER BY c.at, f.name
  `);
  return rows.map(toChange);
}

/** Far enough ahead to mean "everything recorded". */
export const END_OF_TIME = new Date('9999-12-31T00:00:00Z');

export interface NumericPoint {
  at: number;
  value: number;
}

/**
 * A numeric field over [from, to]: the value held at `from` (if known)
 * and each change after. Non-numeric readings are left out.
 */
export async function numericSeries(
  db: Db,
  vehicleId: string,
  field: string,
  from: Date,
  to: Date,
): Promise<{ opening: NumericPoint | null; changes: NumericPoint[] }> {
  const [[opening], changes] = await Promise.all([
    latestChanges(db, vehicleId, [field], from),
    changesBetween(db, vehicleId, [field], from, to),
  ]);
  const numeric = (c: StateChange | undefined): NumericPoint | null =>
    typeof c?.value === 'number' ? { at: c.at, value: c.value } : null;
  return {
    opening: numeric(opening),
    changes: changes.flatMap((c) => numeric(c) ?? []),
  };
}

/** The fields as they were at `at`, each stamped with when it last changed. */
export async function stateAt(
  db: Db,
  vehicleId: string,
  at: Date,
  fields: readonly string[] | null = null,
): Promise<VehicleState> {
  return applyChanges({}, await latestChanges(db, vehicleId, fields, at));
}

/** When state was being received in [from, to] (ms, in order). */
export async function heartbeatsBetween(
  db: Db,
  vehicleId: string,
  from: Date,
  to: Date,
): Promise<number[]> {
  const rows = await db.execute<{ at: string | Date }>(sql`
    SELECT at FROM state_heartbeats
    WHERE vehicle_seq = ${seqOf(vehicleId)}
      AND at >= ${from.toISOString()}::timestamptz AND at <= ${to.toISOString()}::timestamptz
    ORDER BY at
  `);
  return rows.map((r) => new Date(r.at).getTime());
}

/** When state was first recorded for the vehicle, or null if never. */
export async function firstRecordedAt(db: Db, vehicleId: string): Promise<Date | null> {
  const [row] = await db.execute<{ at: string | Date | null }>(sql`
    SELECT MIN(at) AS at FROM state_heartbeats WHERE vehicle_seq = ${seqOf(vehicleId)}
  `);
  return row?.at ? new Date(row.at) : null;
}

export interface TimelineEntry {
  at: number;
  /** The fields as they were then, each stamped with when it last changed. */
  state: VehicleState;
}

/**
 * The fields over [from, to]: their state at `from` (when any is known),
 * then again at each change and, with `heartbeats`, each heartbeat, so a
 * reader sees values that held while state was arriving.
 */
export async function stateTimeline(
  db: Db,
  vehicleId: string,
  fields: readonly string[],
  from: Date,
  to: Date,
  options: { heartbeats?: boolean } = {},
): Promise<TimelineEntry[]> {
  const [opening, changes, beats] = await Promise.all([
    latestChanges(db, vehicleId, fields, from),
    changesBetween(db, vehicleId, fields, from, to),
    options.heartbeats ? heartbeatsBetween(db, vehicleId, from, to) : Promise.resolve([]),
  ]);
  return timeline(opening, changes, beats, from.getTime());
}

/** Builds a timeline from the opening values, the changes after, and heartbeats (all in order). */
export function timeline(
  opening: readonly StateChange[],
  changes: readonly StateChange[],
  heartbeats: readonly number[],
  from: number,
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  const state = applyChanges({}, opening);
  if (opening.length > 0) entries.push({ at: from, state: { ...state } });
  let i = 0;
  let h = 0;
  while (i < changes.length || h < heartbeats.length) {
    const at = Math.min(changes[i]?.at ?? Infinity, heartbeats[h] ?? Infinity);
    while (i < changes.length && changes[i]!.at === at) applyChanges(state, [changes[i++]!]);
    while (h < heartbeats.length && heartbeats[h] === at) h++;
    if (Object.keys(state).length > 0) entries.push({ at, state: { ...state } });
  }
  return entries;
}

function applyChanges(state: VehicleState, changes: readonly StateChange[]): VehicleState {
  for (const c of changes) {
    state[c.field] = { value: c.value, timeStamp: new Date(c.at).toISOString() };
  }
  return state;
}

export interface SeriesBucket {
  bucket: number;
  avg: number;
  min: number;
  max: number;
}

/** Bucket starts line up with Postgres's date_bin from this origin. */
const BUCKET_ORIGIN = Date.UTC(2020, 0, 1);

/**
 * A numeric field over [from, to] in fixed buckets: each value holds until
 * the next change, so a bucket covers what was held during it, averaged by
 * time. Buckets before the first known value are left out.
 */
export function bucketSeries(
  opening: { at: number; value: number } | null,
  changes: readonly { at: number; value: number }[],
  from: number,
  to: number,
  intervalMs: number,
): SeriesBucket[] {
  const steps = opening ? [opening, ...changes] : changes;
  const out: SeriesBucket[] = [];
  const firstStart = BUCKET_ORIGIN + Math.floor((from - BUCKET_ORIGIN) / intervalMs) * intervalMs;
  // The step held as each bucket opens: the last one at or before it (-1: none yet).
  let held = -1;
  for (let start = firstStart; start < to && steps.length > 0; start += intervalMs) {
    const lo = Math.max(start, from);
    const hi = Math.min(start + intervalMs, to);
    while (held + 1 < steps.length && steps[held + 1]!.at <= lo) held++;
    let weighted = 0;
    let covered = 0;
    let min = Infinity;
    let max = -Infinity;
    for (let j = Math.max(held, 0); j < steps.length && steps[j]!.at < hi; j++) {
      const span = Math.min(steps[j + 1]?.at ?? hi, hi) - Math.max(steps[j]!.at, lo);
      const v = steps[j]!.value;
      min = Math.min(min, v);
      max = Math.max(max, v);
      weighted += v * Math.max(span, 0);
      covered += Math.max(span, 0);
    }
    if (min === Infinity) continue;
    out.push({ bucket: start, avg: covered > 0 ? weighted / covered : min, min, max });
  }
  return out;
}
