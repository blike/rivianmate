/**
 * Integration tests against a real Postgres. Skipped unless
 * TEST_DATABASE_URL points at a disposable database (tables are truncated).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, runMigrations } from '../db/client.js';
import { vehicles } from '../db/schema.js';
import { silentLogger } from '../logger.js';
import { RVM_PARKED_ENERGY } from '../rivian/parallax/index.js';
import { b64, float, int, message } from '../testing/protobuf.js';
import { HistoryKeys } from './history-keys.js';
import { ParallaxArchive } from './parallax-archive.js';
import { readParkedDays } from './parked-energy-days.js';

const url = process.env.TEST_DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));

describe.skipIf(!url)('readParkedDays with Postgres', () => {
  let handle: ReturnType<typeof createDb>;
  let clock = 0;
  const archive = () =>
    new ParallaxArchive(handle.db, new HistoryKeys(handle.db), silentLogger, () => clock);
  /** A parked-energy report of `kwh` over the last 24 hours, sent at `at`. */
  const report = (kwh: number, at: string) => ({
    rvm: RVM_PARKED_ENERGY,
    payload: b64(message(1, [...float(1, kwh), ...float(4, kwh), ...int(11, 1440)])),
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
  });

  it("reads each full day's last report back out of the archive", async () => {
    const a = archive();
    clock = Date.parse('2026-10-10T16:00:00Z');
    await a.ingest('v1', report(1, '2026-10-08T14:00:00Z'));
    await a.ingest('v1', report(1.5, '2026-10-09T14:00:00Z'));
    await a.ingest('v1', report(2, '2026-10-10T01:00:00Z')); // 21:00 on the 9th in New York
    await a.ingest('v1', report(4, '2026-10-10T14:00:00Z')); // today: left out

    const days = await readParkedDays(a, 'v1', 7, 'America/New_York', new Date(clock));
    expect(days.map((d) => [d.day, d.kwh, d.at])).toEqual([
      ['2026-10-08', 1, '2026-10-08T14:00:00.000Z'],
      ['2026-10-09', 2, '2026-10-10T01:00:00.000Z'],
    ]);
    expect(days[1]?.uses).toEqual({ climate: 0, system: 2, gearGuard: 0, outlets: 0 });
  });

  it('reads reports already packed into hourly chunks', async () => {
    const a = archive();
    clock = Date.parse('2026-10-03T12:00:00Z');
    await a.ingest('v1', report(1.5, '2026-10-02T20:00:00Z'));
    // Past the 30 days a report is kept as its own row, so it is rolled up.
    clock = Date.parse('2026-11-10T16:00:00Z');
    await a.ingest('v1', report(2.5, '2026-11-09T20:00:00Z'));
    expect(await a.rollUp()).toBeGreaterThan(0);

    const month = await readParkedDays(a, 'v1', 31, 'UTC', new Date('2026-10-04T00:00:00Z'));
    expect(month.map((d) => [d.day, d.kwh])).toEqual([['2026-10-02', 1.5]]);
    const week = await readParkedDays(a, 'v1', 7, 'UTC', new Date(clock));
    expect(week.map((d) => [d.day, d.kwh])).toEqual([['2026-11-09', 2.5]]);
  });

  it('gives nothing for a vehicle the archive has never seen', async () => {
    clock = Date.parse('2026-10-10T16:00:00Z');
    expect(await readParkedDays(archive(), 'v2', 7, 'UTC', new Date(clock))).toEqual([]);
  });
});
