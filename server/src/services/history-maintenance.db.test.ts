/**
 * Integration tests against a real Postgres. Skipped unless
 * TEST_DATABASE_URL points at a disposable database (tables are truncated).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, runMigrations } from '../db/client.js';
import { appSettings, parallaxLatest, stateHeartbeats, vehicles } from '../db/schema.js';
import { silentLogger } from '../logger.js';
import { ensureLegacyHistoryTables } from '../testing/legacy-tables.js';
import { HistoryKeys } from './history-keys.js';
import { HistoryMaintenance } from './history-maintenance.js';
import { ParallaxArchive } from './parallax-archive.js';
import { changesBetween, END_OF_TIME } from './state-history.js';

const url = process.env.TEST_DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));

describe.skipIf(!url)('HistoryMaintenance with Postgres', () => {
  let handle: ReturnType<typeof createDb>;
  const maintenance = () => {
    const keys = new HistoryKeys(handle.db);
    return new HistoryMaintenance(
      handle.db,
      keys,
      new ParallaxArchive(handle.db, keys),
      silentLogger,
    );
  };
  const exists = async (table: string) =>
    (await handle.sql`SELECT to_regclass(${`public.${table}`})::text AS t`)[0]!.t != null;
  const snapshot = (ts: string, data: object) => ({
    vehicle_id: 'v1',
    ts,
    data: JSON.stringify(data),
  });
  const allChanges = (fields: string[]) =>
    changesBetween(handle.db, 'v1', fields, new Date(0), END_OF_TIME);

  beforeAll(async () => {
    await runMigrations(url!, join(here, '..', '..', 'drizzle'));
    handle = createDb(url!);
  });
  afterAll(async () => {
    await handle.sql.end();
  });
  beforeEach(async () => {
    await handle.sql`TRUNCATE vehicles RESTART IDENTITY CASCADE`;
    await handle.db.delete(appSettings);
    await ensureLegacyHistoryTables(handle.sql);
    await handle.db.insert(vehicles).values({ id: 'v1', vin: 'VIN1' });
  });

  it('converts snapshots into each field’s changes and heartbeats, then drops them', async () => {
    const level = (value: number, timeStamp: string) => ({ batteryLevel: { value, timeStamp } });
    await handle.sql`INSERT INTO vehicle_state_snapshots ${handle.sql([
      snapshot('2026-10-01T10:00:00Z', {
        ...level(80, '2026-10-01T09:58:00Z'),
        gnssLocation: { latitude: 33, longitude: -117, timeStamp: '2026-10-01T09:58:00Z' },
        gearStatus: { value: 'park', timeStamp: '2026-10-01T08:00:00Z' },
      }),
      snapshot('2026-10-01T10:05:00Z', level(80, '2026-10-01T10:04:00Z')),
      snapshot('2026-10-01T10:20:00Z', level(79, '2026-10-01T10:19:00Z')),
    ])}`;
    await maintenance().run();

    expect(
      (await allChanges(['batteryLevel', 'gearStatus', 'gnssLocation'])).map((c) => [
        c.field,
        new Date(c.at).toISOString(),
        c.value,
      ]),
    ).toEqual([
      ['gearStatus', '2026-10-01T08:00:00.000Z', 'park'],
      ['batteryLevel', '2026-10-01T09:58:00.000Z', 80],
      ['batteryLevel', '2026-10-01T10:19:00.000Z', 79],
    ]);
    const beats = await handle.db.select().from(stateHeartbeats).orderBy(stateHeartbeats.at);
    expect(beats.map((b) => b.at.toISOString())).toEqual([
      '2026-10-01T10:00:00.000Z',
      '2026-10-01T10:20:00.000Z',
    ]);
    expect(await exists('vehicle_state_snapshots')).toBe(false);
  });

  it('resumes after the last converted snapshot without recording its values again', async () => {
    const level = (value: number, timeStamp: string) => ({ batteryLevel: { value, timeStamp } });
    await handle.sql`INSERT INTO vehicle_state_snapshots ${handle.sql([
      snapshot('2026-10-01T10:00:00Z', level(80, '2026-10-01T10:00:00Z')),
    ])}`;
    // Converted up to the first row by a run that stopped there.
    await handle.sql`
      INSERT INTO state_fields (name) VALUES ('batteryLevel') ON CONFLICT DO NOTHING`;
    await handle.sql`
      INSERT INTO state_changes (vehicle_seq, field_id, at, num)
      SELECT 1, id, '2026-10-01T10:00:00Z', 80 FROM state_fields WHERE name = 'batteryLevel'`;
    const [{ id }] = await handle.sql`SELECT max(id)::int AS id FROM vehicle_state_snapshots`;
    await handle.db
      .insert(appSettings)
      .values({ key: 'state_history_conversion', value: JSON.stringify({ afterId: id }) });
    await handle.sql`INSERT INTO vehicle_state_snapshots ${handle.sql([
      snapshot('2026-10-01T10:30:00Z', level(80, '2026-10-01T10:29:00Z')),
      snapshot('2026-10-01T11:00:00Z', level(78, '2026-10-01T10:59:00Z')),
    ])}`;
    await maintenance().run();

    expect((await allChanges(['batteryLevel'])).map((c) => c.value)).toEqual([80, 78]);
    expect(await handle.db.select().from(appSettings)).toEqual([]);
  });

  it('moves the Parallax log and latest payloads into the archive, then drops the log', async () => {
    const at = '2026-10-13T10:00:00Z';
    await handle.sql`INSERT INTO parallax_messages ${handle.sql([
      { vehicle_id: 'v1', rvm: 'charging.session.status', payload: 'AQ==', message_at: at },
      { vehicle_id: 'v1', rvm: 'charging.session.status', payload: 'Ag==', message_at: at },
    ])}`;
    await handle.db.insert(parallaxLatest).values([
      // Also the log's latest: not archived twice.
      { vehicleId: 'v1', rvm: 'charging.session.status', payload: 'Ag==', messageAt: new Date(at) },
      { vehicleId: 'v1', rvm: 'vehicle.network.state', payload: 'Aw==', messageAt: new Date(at) },
      { vehicleId: 'v1', rvm: 'energy.high_voltage.battery_state:awake', payload: 'BA==' },
    ]);
    const m = maintenance();
    await m.run();

    const archive = new ParallaxArchive(handle.db, new HistoryKeys(handle.db));
    const range = [new Date('2026-10-01T00:00:00Z'), END_OF_TIME] as const;
    const read = async (rvm: string) =>
      (await archive.messages('v1', rvm, ...range)).map((x) => x.payload);
    expect(await read('charging.session.status')).toEqual(['AQ==', 'Ag==']);
    expect(await read('vehicle.network.state')).toEqual(['Aw==']);
    expect(await read('energy.high_voltage.battery_state:awake')).toEqual([]);
    expect(await exists('parallax_messages')).toBe(false);
  });
});
