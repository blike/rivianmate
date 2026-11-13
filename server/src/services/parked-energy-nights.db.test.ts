/**
 * Integration tests against a real Postgres. Skipped unless
 * TEST_DATABASE_URL points at a disposable database (tables are truncated).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, runMigrations } from '../db/client.js';
import { parkedEnergyNights, vehicles } from '../db/schema.js';
import { silentLogger } from '../logger.js';
import { ParkedEnergyNights } from './parked-energy-nights.js';

const url = process.env.TEST_DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));

describe.skipIf(!url)('ParkedEnergyNights with Postgres', () => {
  let handle: ReturnType<typeof createDb>;

  const window = (minutes: number, kwh: number) => ({
    minutes,
    kwh,
    rangeKm: 5.3,
    uses: { climate: 0.2, system: 0.8, gearGuard: 0.1, outlets: 0 },
  });
  const day = (iso: string) => new Date(iso);
  /** A recorder that thinks the days are UTC's, so the tests can place them. */
  const store = () => new ParkedEnergyNights(handle.db, silentLogger, 'UTC');
  const rows = () => handle.db.select().from(parkedEnergyNights);

  beforeAll(async () => {
    await runMigrations(url!, join(here, '..', '..', 'drizzle'));
    handle = createDb(url!);
  });
  afterAll(async () => {
    await handle.sql.end();
  });
  beforeEach(async () => {
    await handle.sql`TRUNCATE parked_energy_nights, vehicles RESTART IDENTITY CASCADE`;
    await handle.db.insert(vehicles).values({ id: 'v1', vin: 'VIN1' });
  });

  it('writes a night the first time that day’s window arrives, and nothing again that day', async () => {
    const recorder = store();
    const windows = [window(1440, 1.1), window(480, 0.4)];
    await recorder.record('v1', windows, day('2026-10-08T14:00:00Z'));
    // The same day's report again, twice: the row stands and nothing is added.
    await recorder.record('v1', windows, day('2026-10-08T18:00:00Z'));
    await recorder.record('v1', windows, day('2026-10-08T23:59:00Z'));

    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ vehicleId: 'v1', day: '2026-10-08', minutes: 1440 });
    expect(await recorder.recent('v1', 7)).toEqual([
      {
        at: day('2026-10-08T14:00:00Z').toISOString(),
        minutes: 1440,
        kwh: expect.closeTo(1.1),
        rangeKm: expect.closeTo(5.3),
        uses: {
          climate: expect.closeTo(0.2),
          system: expect.closeTo(0.8),
          gearGuard: expect.closeTo(0.1),
          outlets: 0,
        },
      },
    ]);
  });

  it('writes each new day once, keeping the days before it', async () => {
    const recorder = store();
    await recorder.record('v1', [window(1440, 1.1)], day('2026-10-07T14:00:00Z'));
    await recorder.record('v1', [window(1440, 1.3)], day('2026-10-08T14:00:00Z'));

    expect(await rows()).toHaveLength(2);
    expect((await recorder.recent('v1', 7)).map((n) => n.kwh)).toEqual([
      expect.closeTo(1.1),
      expect.closeTo(1.3),
    ]);
  });

  it('records nothing from a payload without a 24-hour window', async () => {
    const recorder = store();
    await recorder.record('v1', [window(480, 0.4), window(111, 0.1)], day('2026-10-08T14:00:00Z'));
    expect(await rows()).toHaveLength(0);
    expect(await recorder.recent('v1', 7)).toEqual([]);
  });

  it('reads the last night back on a restart instead of writing it again', async () => {
    await store().record('v1', [window(1440, 1.1)], day('2026-10-08T14:00:00Z'));
    // A fresh process knows nothing in memory; the table tells it the day.
    await store().record('v1', [window(1440, 1.1)], day('2026-10-08T20:00:00Z'));
    expect(await rows()).toHaveLength(1);
  });

  it("writes the night in the reader's calendar, once a browser has said which", async () => {
    const recorder = store(); // the server's own zone is UTC
    recorder.setZone('America/New_York');
    // 22:00 on the 8th in New York, the 9th in UTC.
    await recorder.record('v1', [window(1440, 1.1)], day('2026-10-09T02:00:00Z'));
    recorder.setZone('not a zone'); // ignored, so the last good one stands
    await recorder.record('v1', [window(1440, 1.2)], day('2026-10-10T02:00:00Z'));

    expect((await rows()).map((r) => r.day)).toEqual(['2026-10-08', '2026-10-09']);
  });

  it('gives back the last nights asked for, oldest first', async () => {
    const recorder = store();
    for (let d = 1; d <= 8; d++) {
      const at = day(`2026-10-0${d}T14:00:00Z`);
      await recorder.record('v1', [window(1440, d / 10)], at);
    }
    const nights = await recorder.recent('v1', 7);
    expect(nights.map((n) => n.at)).toEqual(
      [2, 3, 4, 5, 6, 7, 8].map((d) => day(`2026-10-0${d}T14:00:00Z`).toISOString()),
    );
    expect(nights.at(-1)?.kwh).toBeCloseTo(0.8);
  });
});
