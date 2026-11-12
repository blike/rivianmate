/**
 * The pack temperature metric against a real Postgres; skipped unless
 * TEST_DATABASE_URL is set. It's the one history metric whose band comes from
 * two fields of its own rather than from one field over time, and the one whose
 * readings keep the stamp they were made at.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import type { HistoryPoint } from '../api-types.js';
import type { AppContext } from '../context.js';
import { createDb, runMigrations } from '../db/client.js';
import { stateChanges, vehicles } from '../db/schema.js';
import { HistoryKeys } from '../services/history-keys.js';
import { historyRoutes } from './history.js';

const url = process.env.TEST_DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));

const VEHICLE = 'v1';
const FROM = Date.parse('2026-10-01T14:00:00Z');
const MIN = 60_000;
const WINDOW = 'from=2026-10-01T14:00:00Z&to=2026-10-01T15:00:00Z';
const FIELD = { avg: 'batteryTempAvg', min: 'batteryTempMin', max: 'batteryTempMax' } as const;

describe.skipIf(!url)('pack temperature history with Postgres', () => {
  let handle: ReturnType<typeof createDb>;
  let keys: HistoryKeys;
  let teslamateHistory: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    await runMigrations(url!, join(here, '..', '..', 'drizzle'));
    handle = createDb(url!);
    keys = new HistoryKeys(handle.db);
  });
  afterAll(async () => {
    await handle.sql.end();
  });
  beforeEach(async () => {
    await handle.sql`TRUNCATE vehicles RESTART IDENTITY CASCADE`;
    await handle.db.insert(vehicles).values({ id: VEHICLE, vin: 'VIN1' });
    teslamateHistory = vi.fn(async () => []);
  });

  const get = async (query: string, vehicleId = VEHICLE): Promise<HistoryPoint[]> => {
    const server = Fastify();
    server.setErrorHandler((err, _req, reply) =>
      reply.code(err instanceof ZodError ? 400 : 500).send({ error: String(err) }),
    );
    const ctx = {
      db: handle.db,
      teslamate: { history: teslamateHistory },
    } as unknown as AppContext;
    await historyRoutes(server, ctx);
    const res = await server.inject({ url: `/api/vehicles/${vehicleId}/history?${query}` });
    expect(res.statusCode).toBe(200);
    return res.json() as HistoryPoint[];
  };

  /** Reads `field` at `minutes` into the window; a field left out wasn't in the frame. */
  const record = async (minutes: number, fields: [string, number][]) => {
    const [row] = await handle.db
      .select({ seq: vehicles.seq })
      .from(vehicles)
      .where(eq(vehicles.id, VEHICLE));
    const ids = await keys.fieldIds(fields.map(([name]) => name));
    await handle.db.insert(stateChanges).values(
      fields.map(([name, value]) => ({
        vehicleSeq: row!.seq,
        fieldId: ids.get(name)!,
        at: new Date(FROM + minutes * MIN),
        num: value,
      })),
    );
  };
  /** A frame's readings `minutes` into the window; a field left out wasn't in it. */
  const frame = async (minutes: number, temps: Partial<Record<keyof typeof FIELD, number>>) => {
    const names = Object.keys(temps) as (keyof typeof FIELD)[];
    await record(
      minutes,
      names.map((key) => [FIELD[key], temps[key]!]),
    );
  };

  const minutesOf = (p: HistoryPoint) => (Date.parse(p.bucket) - FROM) / MIN;

  it('reads the average, the coldest cell and the hottest as one series', async () => {
    await frame(0, { avg: 20, min: 19, max: 21.5 });
    await frame(30, { avg: 21, min: 20, max: 23 });
    const points = await get(`metric=temp&bucket=raw&${WINDOW}`);
    expect(points.map(minutesOf)).toEqual([0, 30]);
    expect(points[0]).toEqual({
      bucket: new Date(FROM).toISOString(),
      avg: 20,
      min: 19,
      max: 21.5,
    });
    expect(points[1]!.avg).toBe(21);
    expect(points[1]!.max).toBe(23);
  });

  it('holds each reading until its own field moves again', async () => {
    // A frame that moved only the hottest cell: the other two keep their values.
    await frame(0, { avg: 20, min: 19, max: 21 });
    await frame(10, { max: 24 });
    await frame(20, { avg: 22 });
    const points = await get(`metric=temp&bucket=raw&${WINDOW}`);
    expect(points.map((p) => [minutesOf(p), p.avg, p.min, p.max])).toEqual([
      [0, 20, 19, 21],
      [10, 20, 19, 24],
      [20, 22, 19, 24],
    ]);
  });

  it('keeps a reading made before the window at the time it was made', async () => {
    // What the pack held when the drive began, read an hour earlier: moved to
    // the window's start it would pass for the pack as the drive opened.
    await frame(-60, { avg: 18, min: 17, max: 19 });
    await frame(30, { avg: 21, min: 20, max: 22 });
    const points = await get(`metric=temp&bucket=raw&${WINDOW}`);
    expect(points.map((p) => [minutesOf(p), p.avg, p.min, p.max])).toEqual([
      [-60, 18, 17, 19],
      [30, 21, 20, 22],
    ]);
  });

  it('still carries the value held at the window start into it, for the other metrics', async () => {
    await record(-120, [['batteryLevel', 61]]);
    await record(4, [['batteryLevel', 64]]);

    expect(await get(`metric=battery&bucket=raw&${WINDOW}`)).toEqual([
      { bucket: new Date(FROM).toISOString(), avg: 61, min: 61, max: 61 },
      { bucket: new Date(FROM + 4 * MIN).toISOString(), avg: 64, min: 64, max: 64 },
    ]);
  });

  it('buckets each field, so the band keeps its own extremes over the bucket', async () => {
    await frame(0, { avg: 20, min: 18, max: 22 });
    await frame(20, { avg: 22, min: 21, max: 24 });
    const points = await get(`metric=temp&bucket=1h&${WINDOW}`);
    expect(points).toHaveLength(1);
    expect(points[0]!.min).toBe(18);
    expect(points[0]!.max).toBe(24);
    // Each value holds until the next reading: 20 for 20 minutes, 22 for 40.
    expect(points[0]!.avg).toBeCloseTo(20 + (2 * 40) / 60, 5);
  });

  it('leaves out what the vehicle never reported', async () => {
    await frame(0, { avg: 20 });
    const points = await get(`metric=temp&bucket=raw&${WINDOW}`);
    expect(points).toEqual([
      { bucket: new Date(FROM).toISOString(), avg: 20, min: null, max: null },
    ]);
  });

  it('answers for a TeslaMate vehicle without asking it, as it has no pack temperatures', async () => {
    expect(await get('metric=temp', 'tm-3')).toEqual([]);
    expect(teslamateHistory).not.toHaveBeenCalled();
  });
});
