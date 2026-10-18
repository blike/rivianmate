import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { appSettings, stateChanges, stateHeartbeats } from '../db/schema.js';
import { type Logger, silentLogger } from '../logger.js';
import type { VehicleState } from '../rivian/types.js';
import type { HistoryKeys } from './history-keys.js';
import type { ParallaxArchive } from './parallax-archive.js';
import { HEARTBEAT_MS, StateDiff, changeRows, latestChanges } from './state-history.js';
import { normalizeReadings } from './state-utils.js';

const CONVERSION_KEY = 'state_history_conversion';
const SNAPSHOT_BATCH = 1000;
/** Rows per insert, well under Postgres's limit on query parameters. */
const INSERT_BATCH = 2000;
const ROLL_UP_EVERY_MS = 3600_000;

interface Converting {
  seq: number;
  diff: StateDiff;
  lastHeartbeatAt: number;
}

/**
 * Keeps the history tables in shape in the background: once, converts the
 * tables they replace (whole-state snapshots into state changes, the
 * 30-day Parallax log into the archive) and drops them; then hourly packs
 * old archived Parallax payloads into chunks. Conversion resumes where it
 * left off after a restart, and the app works throughout.
 */
export class HistoryMaintenance {
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;

  constructor(
    private readonly db: Db,
    private readonly keys: HistoryKeys,
    private readonly archive: ParallaxArchive,
    private readonly log: Logger = silentLogger,
  ) {}

  start(): void {
    this.running = this.run();
    this.timer = setInterval(() => void this.rollUp(), ROLL_UP_EVERY_MS);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Resolves once the startup pass is done (for tests and shutdown). */
  settled(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  async run(): Promise<void> {
    try {
      await this.convertParallaxLog();
      await this.convertSnapshots();
    } catch (err) {
      this.log.error({ err }, 'history conversion failed; retrying on next start');
    }
    await this.rollUp();
  }

  private async rollUp(): Promise<void> {
    try {
      let packed = 0;
      for (let n = -1; n !== 0; packed += n) n = await this.archive.rollUp();
      if (packed) this.log.info(`packed ${packed} hours of Parallax payloads`);
    } catch (err) {
      this.log.error({ err }, 'parallax roll-up failed');
    }
  }

  private async tableExists(name: string): Promise<boolean> {
    const [row] = await this.db.execute<{ t: string | null }>(
      sql`SELECT to_regclass(${`public.${name}`})::text AS t`,
    );
    return row?.t != null;
  }

  /** The 30-day Parallax log (and each topic's latest payload) into the archive. */
  async convertParallaxLog(): Promise<void> {
    if (!(await this.tableExists('parallax_messages'))) return;
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO parallax_topics (rvm)
        SELECT rvm FROM parallax_messages
        UNION SELECT rvm FROM parallax_latest WHERE rvm NOT LIKE '%:awake'
        ON CONFLICT DO NOTHING
      `);
      const logged = await tx.execute(sql`
        INSERT INTO parallax_archive (vehicle_seq, topic_id, at, payload)
        SELECT v.seq, t.id, COALESCE(m.message_at, m.received_at), decode(m.payload, 'base64')
        FROM parallax_messages m
        JOIN vehicles v ON v.id = m.vehicle_id
        JOIN parallax_topics t ON t.rvm = m.rvm
      `);
      // Latest payloads of topics that weren't logged, unless already there.
      const latest = await tx.execute(sql`
        INSERT INTO parallax_archive (vehicle_seq, topic_id, at, payload)
        SELECT v.seq, t.id, COALESCE(l.message_at, l.received_at), decode(l.payload, 'base64')
        FROM parallax_latest l
        JOIN vehicles v ON v.id = l.vehicle_id
        JOIN parallax_topics t ON t.rvm = l.rvm
        WHERE l.rvm NOT LIKE '%:awake' AND NOT EXISTS (
          SELECT 1 FROM parallax_archive a
          WHERE a.vehicle_seq = v.seq AND a.topic_id = t.id
            AND a.at = COALESCE(l.message_at, l.received_at)
            AND a.payload = decode(l.payload, 'base64')
        )
      `);
      await tx.execute(sql`DROP TABLE parallax_messages`);
      this.log.info(
        `moved ${logged.count + latest.count} Parallax payloads into the archive; dropped parallax_messages`,
      );
    });
  }

  /**
   * Whole-state snapshots into state changes, oldest first: each field's
   * changes of value at its own stamp, and a heartbeat at most every 15
   * minutes. Live history recorded meanwhile is kept where both have a row.
   */
  async convertSnapshots(): Promise<void> {
    if (!(await this.tableExists('vehicle_state_snapshots'))) return;
    let afterId = await this.cursor();
    const vehicles = new Map<string, Converting>();
    let converted = 0;
    for (;;) {
      const batch = await this.db.execute<{
        id: string;
        vehicle_id: string;
        ts: string | Date;
        data: VehicleState;
      }>(sql`
        SELECT id, vehicle_id, ts, data FROM vehicle_state_snapshots
        WHERE id > ${afterId} ORDER BY id LIMIT ${SNAPSHOT_BATCH}
      `);
      if (batch.length === 0) break;
      const changes: (typeof stateChanges.$inferInsert)[] = [];
      const heartbeats: (typeof stateHeartbeats.$inferInsert)[] = [];
      for (const row of batch) {
        const ts = new Date(row.ts).getTime();
        const v = await this.converting(vehicles, row.vehicle_id, ts);
        if (!v) continue;
        // Older snapshots kept float32 noise (63.200001) that live readings drop.
        const state = normalizeReadings(row.data ?? {});
        changes.push(...(await changeRows(this.keys, v.seq, v.diff.changes(state, ts))));
        if (ts - v.lastHeartbeatAt >= HEARTBEAT_MS) {
          v.lastHeartbeatAt = ts;
          heartbeats.push({ vehicleSeq: v.seq, at: new Date(ts) });
        }
      }
      afterId = Number(batch[batch.length - 1]!.id);
      await this.db.transaction(async (tx) => {
        for (let i = 0; i < changes.length; i += INSERT_BATCH) {
          await tx
            .insert(stateChanges)
            .values(changes.slice(i, i + INSERT_BATCH))
            .onConflictDoNothing();
        }
        for (let i = 0; i < heartbeats.length; i += INSERT_BATCH) {
          await tx
            .insert(stateHeartbeats)
            .values(heartbeats.slice(i, i + INSERT_BATCH))
            .onConflictDoNothing();
        }
        const value = JSON.stringify({ afterId });
        await tx
          .insert(appSettings)
          .values({ key: CONVERSION_KEY, value })
          .onConflictDoUpdate({ target: appSettings.key, set: { value } });
      });
      converted += batch.length;
    }
    await this.db.execute(sql`DROP TABLE vehicle_state_snapshots`);
    await this.db.delete(appSettings).where(eq(appSettings.key, CONVERSION_KEY));
    this.log.info(
      `converted ${converted} snapshots into state history; dropped vehicle_state_snapshots`,
    );
  }

  private async cursor(): Promise<number> {
    const [row] = await this.db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, CONVERSION_KEY));
    try {
      return row ? Number((JSON.parse(row.value) as { afterId?: number }).afterId ?? 0) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * A vehicle's conversion state, starting from the values recorded as of
   * its first snapshot here, so resuming doesn't record them again.
   */
  private async converting(
    vehicles: Map<string, Converting>,
    vehicleId: string,
    ts: number,
  ): Promise<Converting | null> {
    const known = vehicles.get(vehicleId);
    if (known) return known;
    const seq = await this.keys.vehicleSeq(vehicleId);
    if (seq === null) return null;
    const last = new Map(
      (await latestChanges(this.db, vehicleId, null, new Date(ts))).map((c) => [c.field, c.value]),
    );
    const v = { seq, diff: new StateDiff(last), lastHeartbeatAt: 0 };
    vehicles.set(vehicleId, v);
    return v;
  }
}
