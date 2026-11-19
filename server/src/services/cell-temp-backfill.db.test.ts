/**
 * Integration tests against a real Postgres. Skipped unless
 * TEST_DATABASE_URL points at a disposable database (tables are truncated).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, runMigrations } from '../db/client.js';
import { appSettings, parallaxArchive, stateChanges, stateFields, vehicles } from '../db/schema.js';
import { silentLogger } from '../logger.js';
import { RVM_BATTERY_STATE } from '../rivian/parallax/domains/energy.js';
import { b64, double, float, int, message } from '../testing/protobuf.js';
import { BACKFILL_KEY, backfillCellTemps } from './cell-temp-backfill.js';
import { HistoryMaintenance } from './history-maintenance.js';
import { HistoryKeys } from './history-keys.js';
import { ParallaxArchive } from './parallax-archive.js';

// A shared disposable container can push a case past the default timeout.
vi.setConfig({ testTimeout: 20_000 });

const url = process.env.TEST_DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));

describe.skipIf(!url)('cell temperature backfill with Postgres', () => {
  let handle: ReturnType<typeof createDb>;
  let keys: HistoryKeys;
  let archive: ParallaxArchive;

  const at = Date.parse('2026-10-01T13:40:00Z');
  const payload = (temps: [number, number, number] | null, verdict?: number) =>
    b64([
      ...message(1, [...double(1, 58.2), ...double(2, 111.285)]),
      ...(temps
        ? message(2, [...float(1, temps[0]), ...float(2, temps[1]), ...float(3, temps[2])])
        : []),
      ...(verdict === undefined ? [] : int(4, verdict)),
    ]);

  const archivePayload = async (payloadB64: string, minutes: number, vehicleId = 'v1') => {
    const [vehicle] = await handle.db
      .select({ seq: vehicles.seq })
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId));
    const topicId = (await keys.topicIds([RVM_BATTERY_STATE])).get(RVM_BATTERY_STATE)!;
    await handle.db.insert(parallaxArchive).values({
      vehicleSeq: vehicle!.seq,
      topicId,
      at: new Date(at + minutes * 60_000),
      payload: Buffer.from(payloadB64, 'base64'),
    });
  };

  const rows = async () => {
    const names = await handle.db.select().from(stateFields);
    const byId = new Map(names.map((f) => [f.id, f.name]));
    const all = await handle.db.select().from(stateChanges);
    return all.map((r) => ({
      field: byId.get(r.fieldId),
      at: r.at.getTime(),
      num: r.num,
      value: r.value,
    }));
  };

  beforeAll(async () => {
    await runMigrations(url!, join(here, '..', '..', 'drizzle'));
    handle = createDb(url!);
    await handle.sql`TRUNCATE state_fields RESTART IDENTITY CASCADE`;
    keys = new HistoryKeys(handle.db);
    archive = new ParallaxArchive(handle.db, keys, silentLogger);
  });
  afterAll(async () => {
    await handle.sql.end();
  });
  beforeEach(async () => {
    await handle.sql`TRUNCATE vehicles RESTART IDENTITY CASCADE`;
    await handle.sql`TRUNCATE app_settings`;
    await handle.db.insert(vehicles).values({ id: 'v1', vin: 'VIN1' });
  });

  const deps = () => ({ db: handle.db, keys, archive, log: silentLogger });
  const run = (until = new Date(at + 3600_000)) => backfillCellTemps(deps(), until);
  const progress = async () => {
    const [row] = await handle.db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, BACKFILL_KEY));
    return row
      ? (JSON.parse(row.value) as { done?: boolean; after?: Record<string, string> })
      : null;
  };

  it('replays temperatures and the verdict as state rows', async () => {
    await archivePayload(payload([42.8, 46.6, 37.2], 1), 0);
    expect(await run()).toEqual({ payloads: 1, rows: 4 });
    const written = await rows();
    expect(written.map((r) => r.field).sort()).toEqual([
      'batteryPowerOutputStatus',
      'batteryTempAvg',
      'batteryTempMax',
      'batteryTempMin',
    ]);
    expect(written.every((r) => r.at === at)).toBe(true);
    expect(written.find((r) => r.field === 'batteryTempAvg')?.num).toBeCloseTo(42.8);
    expect(written.find((r) => r.field === 'batteryPowerOutputStatus')?.value).toBe('normal');
  });

  it('records a verdict sent without temperatures', async () => {
    await archivePayload(payload(null, 2), 0);
    expect(await run()).toEqual({ payloads: 1, rows: 1 });
    expect((await rows()).map((r) => [r.field, r.value])).toEqual([
      ['batteryPowerOutputStatus', 'cold'],
    ]);
  });

  it('drops a frame whose temperatures are the float default', async () => {
    await archivePayload(payload([5.9604645e-7, 5.9604645e-7, 5.9604645e-7]), 0);
    expect(await run()).toEqual({ payloads: 1, rows: 0 });
  });

  it('keeps a genuine 0 °C reading', async () => {
    await archivePayload(payload([0, 0.4, -0.3]), 0);
    expect((await run())?.rows).toBe(3);
  });

  it('records a change only once it moves past the deadband', async () => {
    await archivePayload(payload([42.8, 46.6, 37.2]), 0);
    await archivePayload(payload([42.9, 46.7, 37.3]), 1);
    await archivePayload(payload([43.6, 47.4, 38.0]), 2);
    expect((await run())?.rows).toBe(6);
    const avg = (await rows()).filter((r) => r.field === 'batteryTempAvg');
    expect(avg.map((r) => r.num)).toEqual([42.8, 43.6]);
  });

  it('runs once, then skips', async () => {
    await archivePayload(payload([42.8, 46.6, 37.2]), 0);
    await run();
    expect(await progress()).toEqual({ done: true });
    await archivePayload(payload([50, 52, 48]), 10);
    expect(await run()).toBeNull();
    expect((await rows()).length).toBe(3);
  });

  it('skips rows the live recorder already wrote', async () => {
    await archivePayload(payload([42.8, 46.6, 37.2], 2), 0);
    await run();
    await handle.db.delete(appSettings).where(eq(appSettings.key, BACKFILL_KEY));
    expect((await run())?.rows).toBe(0);
    expect((await rows()).length).toBe(4);
  });

  it('resumes each vehicle from where an interrupted run left it', async () => {
    await handle.db.insert(vehicles).values({ id: 'v2', vin: 'VIN2' });
    await archivePayload(payload([42.8, 46.6, 37.2]), 0, 'v1');
    await archivePayload(payload([21.0, 23.4, 19.8]), 0, 'v2');
    await handle.db.insert(appSettings).values({
      key: BACKFILL_KEY,
      value: JSON.stringify({ after: { v1: new Date(at + 3600_000).toISOString() } }),
    });
    expect(await run()).toEqual({ payloads: 1, rows: 3 });
  });

  it('reads rolled-up chunks', async () => {
    const packed = new ParallaxArchive(handle.db, keys, silentLogger, () => at);
    await archivePayload(payload([42.8, 46.6, 37.2]), -40 * 24 * 60);
    await packed.rollUp();
    expect((await run())?.rows).toBe(3);
  });

  it('runs as part of history maintenance at startup', async () => {
    await archivePayload(payload([42.8, 46.6, 37.2]), 0);
    await new HistoryMaintenance(handle.db, keys, archive, silentLogger).run();
    expect((await rows()).length).toBe(3);
    expect(await progress()).toEqual({ done: true });
  });
});
