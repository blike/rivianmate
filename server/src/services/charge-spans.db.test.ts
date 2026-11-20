/**
 * When the vehicle was plugged in, read from recorded charger status. Runs
 * when TEST_DATABASE_URL points at a disposable database (tables are truncated).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, runMigrations } from '../db/client.js';
import { stateChanges, vehicles } from '../db/schema.js';
import { pluggedInAt } from './charge-spans.js';
import { HistoryKeys } from './history-keys.js';
import { changeRows } from './state-history.js';

const url = process.env.TEST_DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));

describe.skipIf(!url)('when the vehicle was plugged in, with Postgres', () => {
  let handle: ReturnType<typeof createDb>;
  let keys: HistoryKeys;
  const UNPLUGGED = 'chrgr_sts_not_connected';
  const PLUGGED = 'chrgr_sts_connected_no_chrg';
  const CHARGING = 'chrgr_sts_connected_charging';

  async function statuses(readings: [string, string][]) {
    const changes = readings.map(([iso, value]) => ({
      field: 'chargerStatus',
      at: Date.parse(iso),
      value,
    }));
    await handle.db.insert(stateChanges).values(await changeRows(keys, 1, changes));
  }
  const at = async () => (await pluggedInAt(handle.db, 'v1'))?.toISOString() ?? null;

  beforeAll(async () => {
    await runMigrations(url!, join(here, '..', '..', 'drizzle'));
    handle = createDb(url!);
    await handle.sql`TRUNCATE state_fields RESTART IDENTITY CASCADE`;
    keys = new HistoryKeys(handle.db);
  });
  afterAll(async () => {
    await handle.sql.end();
  });
  beforeEach(async () => {
    await handle.sql`TRUNCATE vehicles RESTART IDENTITY CASCADE`;
    await handle.db.insert(vehicles).values({ id: 'v1', vin: 'VIN1' });
  });

  it('is the plug-in, not the last charge or pause since', async () => {
    await statuses([
      ['2026-11-01T18:00:00Z', UNPLUGGED],
      ['2026-11-01T19:42:00Z', PLUGGED],
      ['2026-11-01T23:00:00Z', CHARGING],
      ['2026-11-02T02:00:00Z', PLUGGED],
    ]);
    expect(await at()).toBe('2026-11-01T19:42:00.000Z');
  });

  it('is the latest plug-in after an unplug', async () => {
    await statuses([
      ['2026-11-01T19:42:00Z', PLUGGED],
      ['2026-11-02T07:00:00Z', UNPLUGGED],
      ['2026-11-02T18:10:00Z', CHARGING],
    ]);
    expect(await at()).toBe('2026-11-02T18:10:00.000Z');
  });

  it('is null once unplugged, or with nothing recorded', async () => {
    expect(await at()).toBeNull();
    await statuses([
      ['2026-11-01T19:42:00Z', PLUGGED],
      ['2026-11-02T07:00:00Z', UNPLUGGED],
    ]);
    expect(await at()).toBeNull();
  });
});
