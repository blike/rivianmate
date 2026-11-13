/**
 * Replay the archived battery-state payloads into state changes, so the cell
 * temperatures have history from before the decoder existed.
 *
 *   node dist/cli/backfill-cell-temps.js [--vehicle <id>] [--from <ISO>] [--to <ISO>]
 *                                        [--dry-run] [--reset] [--batch-hours <n>]
 *
 * Safe to run under a live recorder: rows land on the timestamps the recorder
 * writes, so it collides rather than duplicates. Re-running is free.
 */
import type { Config } from '../config.js';
import { createDb } from '../db/client.js';
import { createLogger } from '../logger.js';
import { parseArgs } from '../services/cell-temp-backfill-args.js';
import { backfillCellTemps } from '../services/cell-temp-backfill.js';
import { HistoryKeys } from '../services/history-keys.js';
import { ParallaxArchive } from '../services/parallax-archive.js';

try {
  const args = parseArgs(process.argv.slice(2));
  // The job reads and writes history and nothing else, so it takes the three settings
  // it needs rather than the app's full environment, which would demand APP_SECRET.
  const databaseUrl =
    process.env.DATABASE_URL ?? 'postgres://rivianmate:rivianmate@localhost:5432/rivianmate';
  const logLevel = (process.env.LOG_LEVEL ?? 'info') as Config['LOG_LEVEL'];
  const logFormat = (process.env.LOG_FORMAT ?? 'pretty') as Config['LOG_FORMAT'];
  const { db, sql } = createDb(databaseUrl);
  // stderr, so the JSON line below is the only thing on stdout and can be piped.
  const log = createLogger({ LOG_LEVEL: logLevel, LOG_FORMAT: logFormat }, process.stderr);
  const keys = new HistoryKeys(db);
  const jobLog = log.child({ component: 'cell-temp-backfill' });
  const archive = new ParallaxArchive(db, keys, jobLog);
  const result = await backfillCellTemps({ db, keys, archive, log: jobLog }, args);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  // Let the pool close so the JSON line is flushed before the process exits.
  await sql.end({ timeout: 5 }).catch(() => undefined);
  process.exitCode = 0;
} catch (err) {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
}
