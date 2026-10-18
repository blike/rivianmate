/**
 * Integration tests against a real Postgres. Skipped unless
 * TEST_DATABASE_URL points at a disposable database (tables are truncated).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, runMigrations } from '../db/client.js';
import { parallaxArchive, parallaxChunks, vehicles } from '../db/schema.js';
import { silentLogger } from '../logger.js';
import { HistoryKeys } from './history-keys.js';
import { ARCHIVE_ROWS_MS, ParallaxArchive, packChunk, unpackChunk } from './parallax-archive.js';

const url = process.env.TEST_DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));

describe('parallax chunks', () => {
  it('pack and unpack losslessly', () => {
    const entries = [
      { at: Date.parse('2026-10-13T10:00:00.123Z'), payload: Buffer.from([1, 2, 3]) },
      { at: Date.parse('2026-10-13T10:00:00.123Z'), payload: Buffer.alloc(0) },
      { at: Date.parse('2026-10-13T10:59:59.999Z'), payload: Buffer.alloc(700, 7) },
    ];
    expect(unpackChunk(packChunk(entries))).toEqual(entries);
  });
});

describe.skipIf(!url)('ParallaxArchive with Postgres', () => {
  let handle: ReturnType<typeof createDb>;
  let clock = 0;
  const archive = () =>
    new ParallaxArchive(handle.db, new HistoryKeys(handle.db), silentLogger, () => clock);
  const msg = (rvm: string, payload: number[], at: string) => ({
    rvm,
    payload: Buffer.from(payload).toString('base64'),
    timestamp: Date.parse(at),
  });

  beforeAll(async () => {
    await runMigrations(url!, join(here, '..', '..', 'drizzle'));
    handle = createDb(url!);
  });
  afterAll(async () => {
    await handle.sql.end();
  });
  beforeEach(async () => {
    await handle.sql`TRUNCATE vehicles RESTART IDENTITY CASCADE`;
    await handle.db.insert(vehicles).values({ id: 'v1', vin: 'VIN1' });
    clock = Date.parse('2026-10-13T12:00:00Z');
  });

  it("keeps every topic's distinct payloads, not repeats, even across a restart", async () => {
    const a = archive();
    await a.ingest('v1', msg('dynamics.tires.state', [1], '2026-10-13T11:00:00Z'));
    await a.ingest('v1', msg('dynamics.tires.state', [1], '2026-10-13T11:00:10Z'));
    await a.ingest('v1', msg('some.unknown.topic', [9], '2026-10-13T11:00:11Z'));
    await a.ingest('v1', msg('dynamics.tires.state', [2], '2026-10-13T11:00:20Z'));
    await archive().ingest('v1', msg('dynamics.tires.state', [2], '2026-10-13T11:05:00Z'));

    const tires = await a.messages(
      'v1',
      'dynamics.tires.state',
      new Date('2026-10-13T00:00:00Z'),
      new Date('2026-10-14T00:00:00Z'),
    );
    expect(tires.map((m) => [m.at.toISOString(), m.payload])).toEqual([
      ['2026-10-13T11:00:00.000Z', 'AQ=='],
      ['2026-10-13T11:00:20.000Z', 'Ag=='],
    ]);
    expect(await handle.db.select().from(parallaxArchive)).toHaveLength(3);
  });

  it('keeps distinct payloads stamped in the same second', async () => {
    const a = archive();
    await a.ingest('v1', msg('body.locks.states', [1], '2026-10-13T11:00:00Z'));
    await a.ingest('v1', msg('body.locks.states', [2], '2026-10-13T11:00:00Z'));
    expect(await handle.db.select().from(parallaxArchive)).toHaveLength(2);
  });

  it('packs payloads past the row window into hourly chunks, read back the same', async () => {
    const a = archive();
    const old = '2026-09-01T10:';
    await a.ingest('v1', msg('dynamics.tires.state', [1], `${old}05:00Z`));
    await a.ingest('v1', msg('dynamics.tires.state', [2], `${old}55:00Z`));
    await a.ingest('v1', msg('dynamics.tires.state', [3], '2026-09-01T11:01:00Z'));
    await a.ingest('v1', msg('dynamics.tires.state', [4], '2026-10-13T11:00:00Z'));
    const range = [new Date('2026-08-01T00:00:00Z'), new Date('2026-11-01T00:00:00Z')] as const;
    const before = await a.messages('v1', 'dynamics.tires.state', ...range);

    clock = Date.parse('2026-09-01T12:00:00Z') + ARCHIVE_ROWS_MS;
    expect(await a.rollUp()).toBe(2);
    expect(await a.rollUp()).toBe(0);

    const chunks = await handle.db.select().from(parallaxChunks).orderBy(parallaxChunks.hour);
    expect(chunks.map((c) => [c.hour.toISOString(), c.count])).toEqual([
      ['2026-09-01T10:00:00.000Z', 2],
      ['2026-09-01T11:00:00.000Z', 1],
    ]);
    expect(await handle.db.select().from(parallaxArchive)).toHaveLength(1);
    expect(await a.messages('v1', 'dynamics.tires.state', ...range)).toEqual(before);
    // A range starting inside an hour still finds that hour's chunk.
    const late = await a.messages(
      'v1',
      'dynamics.tires.state',
      new Date(`${old}30:00Z`),
      new Date('2026-09-01T11:30:00Z'),
    );
    expect(late.map((m) => m.payload)).toEqual(['Ag==', 'Aw==']);
  });

  it('adds a late payload to the chunk already packed for its hour', async () => {
    const a = archive();
    await a.ingest('v1', msg('dynamics.tires.state', [1], '2026-09-01T10:05:00Z'));
    clock = Date.parse('2026-09-01T12:00:00Z') + ARCHIVE_ROWS_MS;
    await a.rollUp();
    await a.ingest('v1', msg('dynamics.tires.state', [2], '2026-09-01T10:01:00Z'));
    await a.rollUp();

    const [chunk] = await handle.db.select().from(parallaxChunks);
    expect(chunk!.count).toBe(2);
    expect(unpackChunk(chunk!.data).map((e) => [...e.payload])).toEqual([[2], [1]]);
  });
});
