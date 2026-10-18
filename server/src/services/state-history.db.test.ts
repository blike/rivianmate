/**
 * Integration tests against a real Postgres. Skipped unless
 * TEST_DATABASE_URL points at a disposable database (tables are truncated).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, runMigrations } from '../db/client.js';
import { stateChanges, stateHeartbeats, vehicles } from '../db/schema.js';
import type { VehicleState } from '../rivian/types.js';
import { HistoryKeys } from './history-keys.js';
import { StateHistoryRecorder, numericSeries, stateAt, stateTimeline } from './state-history.js';

const url = process.env.TEST_DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));

describe.skipIf(!url)('StateHistoryRecorder with Postgres', () => {
  let handle: ReturnType<typeof createDb>;
  let clock = 0;
  const recorder = () =>
    new StateHistoryRecorder(handle.db, new HistoryKeys(handle.db), () => clock);
  const reading = (value: string | number, timeStamp: string) => ({ value, timeStamp });
  const record = (r: StateHistoryRecorder, state: VehicleState) =>
    r.record('v1', state, Object.keys(state));
  const changes = () =>
    handle.db.select().from(stateChanges).orderBy(stateChanges.at, stateChanges.fieldId);

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

  it('records changes of value at their own stamps, not re-stamps', async () => {
    const r = recorder();
    await record(r, {
      batteryLevel: reading(80, '2026-10-13T11:00:00Z'),
      gearStatus: reading('park', '2026-10-13T09:00:00Z'),
    });
    await record(r, { batteryLevel: reading(80, '2026-10-13T11:30:00Z') });
    await record(r, { batteryLevel: reading(79.5, '2026-10-13T11:45:00Z') });

    expect((await changes()).map((c) => [c.at.toISOString(), c.num ?? c.value])).toEqual([
      ['2026-10-13T09:00:00.000Z', 'park'],
      ['2026-10-13T11:00:00.000Z', 80],
      ['2026-10-13T11:45:00.000Z', 79.5],
    ]);
  });

  it("doesn't record a vehicle's values again after a restart", async () => {
    await record(recorder(), { batteryLevel: reading(80, '2026-10-13T11:00:00Z') });
    clock += 3600_000;
    await record(recorder(), {
      batteryLevel: reading(80, '2026-10-13T12:30:00Z'),
      gearStatus: reading('park', '2026-10-13T12:30:00Z'),
    });
    expect((await changes()).map((c) => c.num ?? c.value)).toEqual([80, 'park']);
  });

  it('records what the state held when called, whatever changes after', async () => {
    const r = recorder();
    const state: VehicleState = { batteryLevel: reading(80, '2026-10-13T11:00:00Z') };
    const first = record(r, state);
    state.batteryLevel = reading(10, '2026-10-13T11:01:00Z');
    await first;
    expect((await changes()).map((c) => c.num)).toEqual([80]);
  });

  it('writes a heartbeat at most every 15 minutes', async () => {
    const r = recorder();
    for (const minutes of [0, 5, 14, 15, 29, 31]) {
      clock = Date.parse('2026-10-13T12:00:00Z') + minutes * 60_000;
      await record(r, { batteryLevel: reading(80 - minutes, new Date(clock).toISOString()) });
    }
    const beats = await handle.db.select().from(stateHeartbeats).orderBy(stateHeartbeats.at);
    expect(beats.map((b) => b.at.toISOString())).toEqual([
      '2026-10-13T12:00:00.000Z',
      '2026-10-13T12:15:00.000Z',
      '2026-10-13T12:31:00.000Z',
    ]);
  });

  it('reads state at a moment, a timeline, and a numeric series', async () => {
    const r = recorder();
    await record(r, {
      batteryLevel: reading(80, '2026-10-13T10:00:00Z'),
      gearStatus: reading('park', '2026-10-13T10:00:00Z'),
    });
    await record(r, { gearStatus: reading('drive', '2026-10-13T10:30:00Z') });
    await record(r, { batteryLevel: reading(75, '2026-10-13T11:00:00Z') });

    expect(await stateAt(handle.db, 'v1', new Date('2026-10-13T10:45:00Z'))).toEqual({
      batteryLevel: { value: 80, timeStamp: '2026-10-13T10:00:00.000Z' },
      gearStatus: { value: 'drive', timeStamp: '2026-10-13T10:30:00.000Z' },
    });

    const timeline = await stateTimeline(
      handle.db,
      'v1',
      ['gearStatus'],
      new Date('2026-10-13T10:15:00Z'),
      new Date('2026-10-13T12:00:00Z'),
      { heartbeats: true },
    );
    expect(timeline.map((e) => [new Date(e.at).toISOString(), e.state.gearStatus])).toEqual([
      ['2026-10-13T10:15:00.000Z', { value: 'park', timeStamp: '2026-10-13T10:00:00.000Z' }],
      ['2026-10-13T10:30:00.000Z', { value: 'drive', timeStamp: '2026-10-13T10:30:00.000Z' }],
      // The heartbeat from the first call, at the recorder's clock.
      ['2026-10-13T12:00:00.000Z', { value: 'drive', timeStamp: '2026-10-13T10:30:00.000Z' }],
    ]);

    expect(
      await numericSeries(
        handle.db,
        'v1',
        'batteryLevel',
        new Date('2026-10-13T10:15:00Z'),
        new Date('2026-10-13T12:00:00Z'),
      ),
    ).toEqual({
      opening: { at: Date.parse('2026-10-13T10:00:00Z'), value: 80 },
      changes: [{ at: Date.parse('2026-10-13T11:00:00Z'), value: 75 }],
    });
  });
});
