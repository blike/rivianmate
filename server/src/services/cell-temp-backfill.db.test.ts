/**
 * The cell-temperature replay against a real Postgres. Skipped unless
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
import { CURSOR_KEY, backfillCellTemps } from './cell-temp-backfill.js';
import { HistoryKeys } from './history-keys.js';
import { ParallaxArchive } from './parallax-archive.js';

// These run against a shared disposable container, where a loaded machine can push a
// case past the default; the work per case is a handful of queries.
vi.setConfig({ testTimeout: 20_000 });

const url = process.env.TEST_DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));
const DAY = 86_400_000;

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

  /** Archive one payload for a vehicle at `minutes` past the base time. */
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

  const run = (options = {}) =>
    backfillCellTemps(
      { db: handle.db, keys, archive, log: silentLogger },
      { from: new Date(at - 3600_000), to: new Date(at + 3600_000), ...options },
    );

  it('replays temperatures and the verdict as state rows', async () => {
    await archivePayload(payload([42.8, 46.6, 37.2], 1), 0);
    expect(await run()).toEqual({ payloads: 1, rows: 4, vehicles: 1 });
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

  it('records a verdict the frame carries on its own, as the live path does', async () => {
    await archivePayload(payload(null, 2), 0);
    expect(await run()).toEqual({ payloads: 1, rows: 1, vehicles: 1 });
    expect((await rows()).map((r) => [r.field, r.value])).toEqual([
      ['batteryPowerOutputStatus', 'cold'],
    ]);
  });

  it('drops a frame whose temperatures are the float default', async () => {
    await archivePayload(payload([5.9604645e-7, 5.9604645e-7, 5.9604645e-7]), 0);
    expect(await run()).toEqual({ payloads: 1, rows: 0, vehicles: 0 });
    expect(await rows()).toEqual([]);
  });

  it('keeps a genuine 0 °C reading, which is a cold morning and not a default', async () => {
    await archivePayload(payload([0, 0.4, -0.3]), 0);
    expect((await run()).rows).toBe(3);
  });

  it('records a change once it moves past the deadband, and not for a repeat', async () => {
    await archivePayload(payload([42.8, 46.6, 37.2]), 0);
    await archivePayload(payload([42.9, 46.7, 37.3]), 1); // under 0.5 °C: no row
    await archivePayload(payload([43.6, 47.4, 38.0]), 2); // past it: a row
    // Three fields at the first frame, three at the third; no verdict in these frames.
    expect((await run()).rows).toBe(6);
    const avg = (await rows()).filter((r) => r.field === 'batteryTempAvg');
    expect(avg.map((r) => r.num)).toEqual([42.8, 43.6]);
  });

  it('is idempotent: the same range again writes nothing and leaves the rows alone', async () => {
    await archivePayload(payload([42.8, 46.6, 37.2], 2), 0);
    expect((await run()).rows).toBe(4);
    // The same explicit range, so the archive is really re-read and the conflict path runs.
    expect((await run()).rows).toBe(0);
    expect((await rows()).length).toBe(4);
  });

  it('resumes from the cursor rather than re-reading the archive', async () => {
    await archivePayload(payload([42.8, 46.6, 37.2]), 0);
    await run();
    const [cursor] = await handle.db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, CURSOR_KEY));
    expect(JSON.parse(cursor!.value)).toEqual({
      after: { v1: new Date(at + 3600_000).toISOString() },
    });
    const resumed = await backfillCellTemps(
      { db: handle.db, keys, archive, log: silentLogger },
      {},
    );
    expect(resumed.payloads).toBe(0);
  });

  it('keeps a cursor per vehicle, so a second vehicle is not skipped', async () => {
    await handle.db.insert(vehicles).values({ id: 'v2', vin: 'VIN2' });
    await archivePayload(payload([42.8, 46.6, 37.2]), 0, 'v1');
    await archivePayload(payload([21.0, 23.4, 19.8], 2), 0, 'v2');
    const result = await run({ from: undefined, reset: true });
    expect(result.vehicles).toBe(2);
    // v1 carries three temperatures and no verdict; v2 carries three and a verdict.
    expect(result.rows).toBe(7);
    const [cursor] = await handle.db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, CURSOR_KEY));
    const after = (JSON.parse(cursor!.value) as { after: Record<string, string> }).after;
    expect(Object.keys(after).sort()).toEqual(['v1', 'v2']);
  });

  it('reads rolled-up chunks, which is where anything older than 30 days lives', async () => {
    const old = 40 * DAY;
    const packed = new ParallaxArchive(handle.db, keys, silentLogger, () => at);
    await archivePayload(payload([42.8, 46.6, 37.2]), -40 * 24 * 60);
    await packed.rollUp();
    const result = await backfillCellTemps(
      { db: handle.db, keys, archive, log: silentLogger },
      { from: new Date(at - old - DAY), to: new Date(at - old + DAY) },
    );
    expect(result.rows).toBe(3);
  });

  it('counts a dry run without writing rows or field names', async () => {
    await archivePayload(payload([42.8, 46.6, 37.2]), 0);
    // Field names outlive the per-test truncation (state changes cascade, the registry does not),
    // so the assertion is that a dry run adds none — registering one is itself a write.
    const before = (await handle.db.select().from(stateFields)).map((f) => f.name).sort();
    expect((await run({ dryRun: true })).rows).toBe(3);
    expect(await rows()).toEqual([]);
    const after = (await handle.db.select().from(stateFields)).map((f) => f.name).sort();
    expect(after).toEqual(before);
  });
});
