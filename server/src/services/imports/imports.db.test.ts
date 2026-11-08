/**
 * Integration tests against a real Postgres. Skipped unless
 * TEST_DATABASE_URL points at a disposable database (tables are truncated).
 */
import { asc, eq, sql } from 'drizzle-orm';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, runMigrations } from '../../db/client.js';
import {
  chargingCurvePoints,
  chargingSessions,
  drivers,
  drives,
  importBatches,
  importSessionFills,
  locationPoints,
  savedLocations,
  stateChanges,
  stateFields,
  stateHeartbeats,
  vehicles,
} from '../../db/schema.js';
import { HistoryKeys } from '../history-keys.js';
import { changesBetween, latestChanges } from '../state-history.js';
import { loadStateSpans } from '../state-spans.js';
import { ImportError, Imports } from './imports.js';
import { asleep, awake, chargeRows, csvOf, driveRows } from '../../testing/electrafi-rows.js';
import { roamerExport } from '../../testing/roamer-archive.js';

const url = process.env.TEST_DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));

describe.skipIf(!url)('ElectraFi import with Postgres', () => {
  let handle: ReturnType<typeof createDb>;
  let imports: Imports;
  let lookups: ReturnType<typeof vi.fn>;
  const NOW = Date.parse('2026-11-15T00:00:00Z');
  const selection = {
    vehicleId: 'v1',
    timeZone: 'UTC',
    from: '2026-01-01',
    to: '2026-12-31',
  };

  const upload = (csv: string | Buffer, draft?: string) =>
    imports.addFile(draft, 'export.csv', Readable.from(Buffer.from(csv)));
  const importCsv = async (csv: string, overrides = {}) => {
    const { id } = await upload(csv);
    const batch = await imports.start(id, { ...selection, ...overrides });
    await imports.idle();
    const [row] = await handle.db
      .select()
      .from(importBatches)
      .where(eq(importBatches.id, batch.id));
    return row!;
  };
  /** Live data arriving now and then around `at`. */
  const liveChange = async (field: string, at: string, num: number | null, value?: string) => {
    const [row] = await handle.db
      .insert(stateFields)
      .values({ name: field })
      .onConflictDoUpdate({ target: stateFields.name, set: { name: field } })
      .returning();
    await handle.db
      .insert(stateChanges)
      .values({ vehicleSeq: 1, fieldId: row!.id, at: new Date(at), num, value });
  };
  const liveBeat = (at: string) =>
    handle.db.insert(stateHeartbeats).values({ vehicleSeq: 1, at: new Date(at) });

  beforeAll(async () => {
    await runMigrations(url!, join(here, '..', '..', '..', 'drizzle'));
    handle = createDb(url!);
  });
  afterAll(async () => {
    await handle.sql.end();
  });
  beforeEach(async () => {
    await handle.sql`TRUNCATE vehicles, state_fields, import_batches, saved_locations RESTART IDENTITY CASCADE`;
    await handle.db.insert(vehicles).values({ id: 'v1', vin: 'VIN1' });
    lookups = vi.fn();
    imports = new Imports(handle.db, new HistoryKeys(handle.db), undefined, lookups, () => NOW);
  });

  it('imports a drive with its route and history, and queues its lookups', async () => {
    const batch = await importCsv(csvOf(driveRows()));
    expect(batch.status).toBe('done');
    expect(batch.counts).toMatchObject({ drives: 1, sessions: 0 });
    expect(batch.format).toBe('electrafi');

    const [drive] = await handle.db.select().from(drives);
    expect(drive!.distanceKm).toBeCloseTo(5.857, 3);
    expect(drive!.startBattery).toBeCloseTo(58.2);
    expect(drive!.endRangeKm).toBeCloseTo(307);
    expect(drive!.importId).toBe(batch.id);
    // Left for the lookups, once the route is there for them to use.
    expect(drive!.placesCheckedAt).toBeNull();
    expect(drive!.weatherCheckedAt).toBeNull();
    expect(lookups).toHaveBeenCalledOnce();

    const points = await handle.db.select().from(locationPoints).orderBy(asc(locationPoints.ts));
    expect(points.length).toBeGreaterThan(0);
    expect(points.filter((p) => p.driveId === drive!.id).length).toBeGreaterThan(0);

    const gear = await changesBetween(
      handle.db,
      'v1',
      ['gearStatus'],
      new Date(0),
      new Date('2027-01-01'),
    );
    expect(gear.map((c) => c.value)).toEqual(['park', 'drive', 'park']);
    const tires = await latestChanges(handle.db, 'v1', ['tirePressureFrontRight'], null);
    expect(tires[0]!.value).toBe(3.35);
  });

  it('gives a drive the driver ElectraFi named, matching one RivianMate knows', async () => {
    const [laura] = await handle.db
      .insert(drivers)
      .values({ vehicleId: 'v1', profileId: 'p-laura', reportedName: 'Laura V.' })
      .returning();
    const preview = await imports.preview(
      (await upload(csvOf(driveRows().map((r) => ({ ...r, autopark_state_v2: 'Laura V.' }))))).id,
      selection,
    );
    expect(preview.drives.map((d) => d.driver)).toEqual(['Laura V.']);
    await importCsv(csvOf(driveRows().map((r) => ({ ...r, autopark_state_v2: 'Laura V.' }))));
    const [drive] = await handle.db.select().from(drives);
    expect(drive).toMatchObject({ driverId: laura!.id, driverSource: 'profile' });
    expect(await handle.db.select().from(drivers)).toHaveLength(1);
  });

  it('gives History what it needs to show awake, asleep, driving and charging', async () => {
    await importCsv(
      csvOf([
        asleep('2026-05-01 09:00:00'),
        awake('2026-05-01 10:00:00'),
        awake('2026-05-01 10:01:00', { shift_state: 'D' }),
        awake('2026-05-01 10:02:00', { shift_state: 'D' }),
        awake('2026-05-01 10:03:00'),
        ...chargeRows(new Date('2026-05-01T10:04:00Z'), 3, 4),
        asleep('2026-05-01 10:10:00'),
      ]),
    );
    const spans = await loadStateSpans(
      handle.db,
      'v1',
      new Date('2026-05-01T08:00:00Z'),
      new Date('2026-05-01T11:00:00Z'),
    );
    expect(spans.map((s) => s.state)).toEqual([
      'asleep',
      'awake',
      'driving',
      'awake',
      'charging',
      'awake',
      'asleep',
    ]);
  });

  it('accepts a gzipped upload, and several files for one import', async () => {
    const { id } = await upload(gzipSync(csvOf(driveRows('2026-10-30').map((r) => ({ ...r })))));
    await upload(csvOf(driveRows('2026-10-31')), id);
    await imports.start(id, selection);
    await imports.idle();
    expect(await handle.db.select().from(drives)).toHaveLength(2);
  });

  it('refuses a file that is not an export, keeping nothing of it', async () => {
    await expect(upload('name,when\nfoo,bar\n')).rejects.toThrow(/ElectraFi/);
    expect((await imports.list()).draft).toBeNull();
  });

  it('refuses a file over the limit, gzipped or not', async () => {
    const small = new Imports(
      handle.db,
      new HistoryKeys(handle.db),
      undefined,
      undefined,
      () => NOW,
      1000,
    );
    const big = csvOf(driveRows());
    const send = (body: string | Buffer) =>
      small.addFile(undefined, 'big.csv', Readable.from(Buffer.from(body)));
    await expect(send(big)).rejects.toThrow(/too large/);
    // Small enough compressed; only too big once unpacked.
    const padded = gzipSync(`${big}${'\n'.repeat(100_000)}`);
    expect(padded.length).toBeLessThan(1000);
    await expect(send(padded)).rejects.toThrow(/too large/);
    expect((await small.list()).draft).toBeNull();
  });

  it('refuses a TeslaMate vehicle and one that does not exist', async () => {
    const { id } = await upload(csvOf(driveRows()));
    await expect(imports.preview(id, { ...selection, vehicleId: 'nope' })).rejects.toBeInstanceOf(
      ImportError,
    );
    await handle.db.insert(vehicles).values({ id: 'tm-1', vin: 'VINT' });
    await expect(imports.preview(id, { ...selection, vehicleId: 'tm-1' })).rejects.toBeInstanceOf(
      ImportError,
    );
  });

  it('previews without writing anything', async () => {
    const { id } = await upload(csvOf(driveRows()));
    const preview = await imports.preview(id, selection);
    expect(preview).toMatchObject({
      firstDate: '2026-10-30',
      lastDate: '2026-10-30',
      rows: 7,
      drivesNew: 1,
      warnings: [],
    });
    expect(await handle.db.select().from(drives)).toHaveLength(0);
    expect(await handle.db.select().from(stateChanges)).toHaveLength(0);
  });

  it('imports a move too short for the drive list without counting it', async () => {
    const csv = csvOf([
      awake('2026-10-29 09:00:00', { odometer: 5000 }),
      awake('2026-10-29 09:01:00', { shift_state: 'D', odometer: 5000 }),
      awake('2026-10-29 09:02:00', { odometer: 5000.03 }),
      awake('2026-10-29 09:06:00', { odometer: 5000.03 }),
      ...driveRows(),
    ]);
    const { id } = await upload(csv);
    const preview = await imports.preview(id, selection);
    expect(preview.drivesNew).toBe(1);
    expect(preview.drives).toHaveLength(1);

    const batch = await importCsv(csv);
    expect(batch.counts).toMatchObject({ drives: 1 });
    expect(await handle.db.select().from(drives)).toHaveLength(2);
  });

  it('lists each drive and charge with what would happen to it', async () => {
    await handle.db.insert(savedLocations).values({
      name: 'Home',
      lat: 10,
      lon: 20,
    });
    await handle.db.insert(drives).values({
      vehicleId: 'v1',
      startedAt: new Date('2026-10-31T12:52:21Z'),
      endedAt: new Date('2026-10-31T13:04:14Z'),
    });
    await handle.db.insert(chargingSessions).values({
      vehicleId: 'v1',
      source: 'rivian',
      startedAt: new Date('2026-05-01T09:50:00Z'),
      endedAt: new Date('2026-05-01T12:00:00Z'),
      energyKwh: 33,
    });
    const { id } = await upload(
      csvOf([
        ...chargeRows(new Date('2026-05-01T10:00:00Z'), 5, 1),
        ...chargeRows(new Date('2026-05-02T10:00:00Z'), 5, 2),
        ...driveRows('2026-10-30'),
        ...driveRows('2026-10-31'),
      ]),
    );
    const preview = await imports.preview(id, selection);
    expect(preview.drives.map((d) => d.status)).toEqual(['new', 'recorded']);
    expect(preview.drives[0]).toMatchObject({
      startedAt: '2026-10-30T12:53:07.000Z',
      startPlace: 'Home',
      endPlace: null,
      startBattery: 58.2,
    });
    expect(preview.charges.map((c) => c.status)).toEqual(['enrich', 'new']);
    expect(preview.charges[0]!.adds).toEqual(
      expect.arrayContaining(['chargingTime', 'batteryLevels', 'power', 'curve']),
    );
    expect(preview.charges[0]!.adds).not.toContain('energy');
    expect(preview.charges[1]).toMatchObject({ place: 'Home', energyKwh: 0.5, adds: [] });
    expect(preview).toMatchObject({
      drivesNew: 1,
      drivesRecorded: 1,
      sessionsNew: 1,
      sessionsEnriched: 1,
    });
  });

  it('shows a charge with nothing to add as already recorded', async () => {
    const [session] = await handle.db
      .insert(chargingSessions)
      .values({
        vehicleId: 'v1',
        source: 'live',
        startedAt: new Date('2026-05-01T09:50:00Z'),
        endedAt: new Date('2026-05-01T12:00:00Z'),
        chargingSeconds: 100,
        startSoc: 1,
        endSoc: 2,
        energyKwh: 3,
        rangeAddedKm: 4,
        avgPowerKw: 5,
        maxPowerKw: 6,
        lat: 7,
        lon: 8,
      })
      .returning();
    await handle.db.insert(chargingCurvePoints).values({
      sessionId: session!.id,
      source: 'observed',
      ts: new Date('2026-05-01T10:00:00Z'),
    });
    const { id } = await upload(csvOf(chargeRows(new Date('2026-05-01T10:00:00Z'), 5, 1)));
    const preview = await imports.preview(id, selection);
    expect(preview.charges[0]).toMatchObject({ status: 'recorded', adds: [] });
    expect(preview.sessionsEnriched).toBe(0);
  });

  it('marks what comes after live recording last reported as newer', async () => {
    await liveBeat('2026-06-01T00:00:00Z');
    const { id } = await upload(
      csvOf([...chargeRows(new Date('2026-07-01T10:00:00Z'), 5, 1), ...driveRows()]),
    );
    const preview = await imports.preview(id, selection);
    expect(preview.drives[0]!.status).toBe('newer');
    expect(preview.charges[0]!.status).toBe('newer');
    expect(preview.drivesNewer).toBe(1);
  });

  it('reads the files once for narrowing dates, and again for a new file or zone', async () => {
    const { id } = await upload(csvOf(driveRows('2026-10-30')));
    const all = await imports.preview(id, selection);
    expect(all.drivesNew).toBe(1);
    const narrow = await imports.preview(id, {
      ...selection,
      from: '2026-11-01',
      to: '2026-11-02',
    });
    expect(narrow).toMatchObject({ drivesNew: 0, readingsNew: 0, rows: 7 });
    await upload(csvOf(driveRows('2026-10-31')), id);
    expect((await imports.preview(id, selection)).drivesNew).toBe(2);
    const shifted = await imports.preview(id, {
      ...selection,
      timeZone: 'America/Los_Angeles',
    });
    expect(shifted.drives[0]!.startedAt).toBe('2026-10-30T19:53:07.000Z');
  });

  it('warns about mileage that does not fit, without stopping the import', async () => {
    await liveChange('vehicleMileage', '2026-01-01T00:00:00Z', 90_000_000);
    const { id } = await upload(csvOf(driveRows()));
    const preview = await imports.preview(id, selection);
    expect(preview.warnings).toContain('odometer');
    await imports.start(id, selection);
    await imports.idle();
    expect(await handle.db.select().from(drives)).toHaveLength(1);
  });

  it('warns when the rows would be in the future', async () => {
    const { id } = await upload(csvOf(driveRows('2026-12-01')));
    expect((await imports.preview(id, selection)).warnings).toContain('future');
  });

  it('adds nothing when the same file is imported again', async () => {
    const csv = csvOf([...driveRows(), ...chargeRows(new Date('2026-10-31T01:00:00Z'), 5, 3)]);
    const first = await importCsv(csv);
    expect(first.counts).toMatchObject({ drives: 1, sessions: 1 });
    const second = await importCsv(csv);
    expect(second.counts).toEqual({
      drives: 0,
      sessions: 0,
      sessionsEnriched: 0,
      locationPoints: 0,
      stateChanges: 0,
    });
  });

  it('leaves a drive RivianMate recorded alone', async () => {
    await handle.db.insert(drives).values({
      vehicleId: 'v1',
      startedAt: new Date('2026-10-30T12:52:21Z'),
      endedAt: new Date('2026-10-30T13:04:14Z'),
      distanceKm: 5.857,
    });
    const batch = await importCsv(csvOf(driveRows()));
    expect(batch.counts).toMatchObject({ drives: 0 });
    expect(await handle.db.select().from(drives)).toHaveLength(1);
  });

  it("puts back what RivianMate last recorded when a window ends, so later history doesn't change", async () => {
    await liveChange('batteryLimit', '2026-01-01T00:00:00Z', 80);
    await liveBeat('2026-01-01T00:00:00Z');
    await liveBeat('2026-11-01T00:00:00Z');
    const batch = await importCsv(
      csvOf([
        awake('2026-06-01 10:00:00', { charge_limit_soc: 70 }),
        awake('2026-06-01 10:01:00', { charge_limit_soc: 70 }),
      ]),
    );
    expect(batch.status).toBe('done');
    const limits = await changesBetween(
      handle.db,
      'v1',
      ['batteryLimit'],
      new Date('2026-05-01'),
      new Date('2027-01-01'),
    );
    expect(limits.map((c) => c.value)).toEqual([70, 80]);
    expect(limits[1]!.at).toBe(Date.parse('2026-06-01T10:01:01Z'));
  });

  it('skips rows past the last live report', async () => {
    await liveBeat('2026-06-01T00:00:00Z');
    const batch = await importCsv(csvOf(driveRows()));
    expect(batch.counts).toMatchObject({ drives: 0, stateChanges: 0, locationPoints: 0 });
  });

  it('imports a new charge with its curve', async () => {
    const batch = await importCsv(csvOf(chargeRows(new Date('2026-05-01T10:00:00Z'), 100, 9)));
    expect(batch.counts).toMatchObject({ sessions: 1 });
    const [session] = await handle.db.select().from(chargingSessions);
    expect(session).toMatchObject({
      source: 'electrafi',
      chargingSeconds: 6000,
      startSoc: 50,
      endSoc: 55,
      energyKwh: 10,
      chargerType: null,
      importId: batch.id,
    });
    const curve = await handle.db.select().from(chargingCurvePoints);
    expect(curve).toHaveLength(100);
    expect(curve[0]).toMatchObject({ source: 'electrafi', powerKw: 6 });
  });

  it("fills only what a Rivian session is missing, keeping Rivian's figures", async () => {
    const [existing] = await handle.db
      .insert(chargingSessions)
      .values({
        vehicleId: 'v1',
        source: 'rivian',
        rivianTransactionId: 'tx1',
        startedAt: new Date('2026-05-01T09:50:00Z'),
        endedAt: new Date('2026-05-01T12:00:00Z'),
        energyKwh: 33,
        cost: '12.50',
      })
      .returning();
    const batch = await importCsv(csvOf(chargeRows(new Date('2026-05-01T10:00:00Z'), 100, 9)));
    expect(batch.counts).toMatchObject({ sessions: 0, sessionsEnriched: 1 });
    const sessions = await handle.db.select().from(chargingSessions);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: existing!.id,
      source: 'rivian',
      energyKwh: 33,
      cost: '12.50',
      chargingSeconds: 6000,
      startSoc: 50,
      endSoc: 55,
      maxPowerKw: 6,
    });
    expect(await handle.db.select().from(chargingCurvePoints)).toHaveLength(100);
  });

  it("doesn't add a curve to a session that has one", async () => {
    const [existing] = await handle.db
      .insert(chargingSessions)
      .values({
        vehicleId: 'v1',
        source: 'live',
        startedAt: new Date('2026-05-01T09:50:00Z'),
        endedAt: new Date('2026-05-01T12:00:00Z'),
      })
      .returning();
    await handle.db.insert(chargingCurvePoints).values({
      sessionId: existing!.id,
      source: 'graph',
      ts: new Date('2026-05-01T10:00:00Z'),
      powerKw: 7,
      soc: 50,
    });
    await importCsv(csvOf(chargeRows(new Date('2026-05-01T10:00:00Z'), 5, 9)));
    expect(await handle.db.select().from(chargingCurvePoints)).toHaveLength(1);
  });

  it('undo removes everything the import added, and only that', async () => {
    await liveChange('batteryLimit', '2026-01-01T00:00:00Z', 80);
    await liveBeat('2026-11-10T00:00:00Z');
    await handle.db.insert(drives).values({
      vehicleId: 'v1',
      startedAt: new Date('2026-01-05T00:00:00Z'),
      endedAt: new Date('2026-01-05T01:00:00Z'),
    });
    const [rivian] = await handle.db
      .insert(chargingSessions)
      .values({
        vehicleId: 'v1',
        source: 'rivian',
        startedAt: new Date('2026-05-01T09:50:00Z'),
        endedAt: new Date('2026-05-01T12:00:00Z'),
      })
      .returning();
    const batch = await importCsv(
      csvOf([
        ...chargeRows(new Date('2026-05-01T10:00:00Z'), 5, 1),
        ...chargeRows(new Date('2026-05-02T10:00:00Z'), 5, 2),
        ...driveRows(),
      ]),
    );
    expect(batch.counts).toMatchObject({ drives: 1, sessions: 1, sessionsEnriched: 1 });

    await imports.undo(batch.id);

    expect(await handle.db.select().from(drives)).toHaveLength(1);
    expect(await handle.db.select().from(locationPoints)).toHaveLength(0);
    expect(await handle.db.select().from(chargingCurvePoints)).toHaveLength(0);
    expect(await handle.db.select().from(stateHeartbeats)).toHaveLength(1);
    expect(await handle.db.select().from(stateChanges)).toHaveLength(1);
    const sessions = await handle.db.select().from(chargingSessions);
    expect(sessions.map((s) => s.id)).toEqual([rivian!.id]);
    expect((await imports.list()).batches).toEqual([]);
  });

  describe('undo of what an import filled in', () => {
    const CHARGE = new Date('2026-05-01T10:00:00Z');
    const existingSession = async (source: 'rivian' | 'live' | 'live+rivian') => {
      const [row] = await handle.db
        .insert(chargingSessions)
        .values({
          vehicleId: 'v1',
          source,
          startedAt: new Date('2026-05-01T09:50:00Z'),
          endedAt: new Date('2026-05-01T12:00:00Z'),
          energyKwh: 33.3,
        })
        .returning();
      return row!;
    };
    const sessionOf = async (id: number) => {
      const [row] = await handle.db
        .select()
        .from(chargingSessions)
        .where(eq(chargingSessions.id, id));
      return row!;
    };

    it.each(['rivian', 'live', 'live+rivian'] as const)(
      'puts a %s session back as it was',
      async (source) => {
        const before = await existingSession(source);
        const batch = await importCsv(csvOf(chargeRows(CHARGE, 5, 1)));
        const filled = await sessionOf(before.id);
        expect(filled.chargingSeconds).not.toBeNull();
        expect(filled.endSoc).not.toBeNull();
        expect(filled.energyKwh).toBeCloseTo(33.3);

        await imports.undo(batch.id);

        expect(await sessionOf(before.id)).toEqual(before);
        expect(await handle.db.select().from(importSessionFills)).toEqual([]);
      },
    );

    it('keeps a value that changed after the import', async () => {
      const before = await existingSession('live');
      const batch = await importCsv(csvOf(chargeRows(CHARGE, 5, 1)));
      await handle.db
        .update(chargingSessions)
        .set({ maxPowerKw: 123.4 })
        .where(eq(chargingSessions.id, before.id));

      await imports.undo(batch.id);

      const after = await sessionOf(before.id);
      expect(after.maxPowerKw).toBeCloseTo(123.4);
      expect(after.chargingSeconds).toBeNull();
    });

    it.each([
      ['first import first', 0, 1],
      ['second import first', 1, 0],
    ])('undoes two imports that filled different fields: %s', async (_name, a, b) => {
      const before = await existingSession('rivian');
      const csv = csvOf(chargeRows(CHARGE, 5, 1));
      const first = await importCsv(csv);
      await handle.db
        .update(chargingSessions)
        .set({ endSoc: null })
        .where(eq(chargingSessions.id, before.id));
      const second = await importCsv(csv);
      const batches = [first, second];
      const filledBySecond = (await sessionOf(before.id)).endSoc;
      expect(filledBySecond).not.toBeNull();

      await imports.undo(batches[a]!.id);
      const between = await sessionOf(before.id);
      // Both filled the end level, so it stays until both are gone.
      expect(between.endSoc).toBe(filledBySecond);
      if (a === 0) expect(between.chargingSeconds).toBeNull();
      else expect(between.chargingSeconds).not.toBeNull();

      await imports.undo(batches[b]!.id);
      expect(await sessionOf(before.id)).toEqual(before);
    });

    it('fills the blanks again when imported again', async () => {
      const before = await existingSession('rivian');
      const csv = csvOf(chargeRows(CHARGE, 5, 1));
      const first = await importCsv(csv);
      const filled = await sessionOf(before.id);
      await imports.undo(first.id);
      const again = await importCsv(csv);
      expect(again.counts).toMatchObject({ sessionsEnriched: 1 });
      expect(await sessionOf(before.id)).toEqual(filled);
    });

    it('restores what an import left running had filled', async () => {
      const before = await existingSession('rivian');
      const [batch] = await handle.db
        .insert(importBatches)
        .values({
          vehicleId: 'v1',
          format: 'electrafi',
          files: ['a.csv'],
          timeZone: 'UTC',
          fromDate: '2026-01-01',
          toDate: '2026-12-31',
        })
        .returning();
      await handle.db
        .update(chargingSessions)
        .set({ chargingSeconds: 600 })
        .where(eq(chargingSessions.id, before.id));
      await handle.db
        .insert(importSessionFills)
        .values({ importId: batch!.id, sessionId: before.id, fields: { chargingSeconds: 600 } });

      await imports.recover();

      expect((await sessionOf(before.id)).chargingSeconds).toBeNull();
      expect(await handle.db.select().from(importSessionFills)).toEqual([]);
    });
  });

  it('undo waits for a running import, whichever one it is', async () => {
    const done = await importCsv(csvOf(driveRows('2026-10-30')));
    const { id } = await upload(csvOf(driveRows('2026-10-31')));
    const running = await imports.start(id, selection);
    await expect(imports.undo(done.id)).rejects.toMatchObject({ status: 409 });
    await expect(imports.undo(running.id)).rejects.toMatchObject({ status: 409 });
    await imports.idle();
    expect(await handle.db.select().from(drives)).toHaveLength(2);
    await imports.undo(done.id);
    expect(await handle.db.select().from(drives)).toHaveLength(1);
  });

  it('undo leaves every table as it was, bar the names of state fields', async () => {
    await handle.db.insert(savedLocations).values({ name: 'Home', lat: 10, lon: 20 });
    await liveChange('batteryLimit', '2026-01-01T00:00:00Z', 80);
    await liveBeat('2026-11-10T00:00:00Z');
    await handle.db.insert(drives).values({
      vehicleId: 'v1',
      startedAt: new Date('2026-01-05T00:00:00Z'),
      endedAt: new Date('2026-01-05T01:00:00Z'),
    });
    await handle.db.insert(chargingSessions).values({
      vehicleId: 'v1',
      source: 'live',
      startedAt: new Date('2026-05-01T09:50:00Z'),
      endedAt: new Date('2026-05-01T12:00:00Z'),
      energyKwh: 33.3,
    });
    const dump = async () => {
      const tables = await handle.db.execute<{ name: string }>(sql`
        SELECT table_name AS name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name <> 'state_fields' ORDER BY 1
      `);
      const out: Record<string, unknown> = {};
      for (const { name } of tables) {
        out[name] = await handle.db.execute(sql`
          SELECT to_jsonb(t) AS row FROM ${sql.identifier(name)} t ORDER BY to_jsonb(t)::text
        `);
      }
      return out;
    };
    const before = await dump();
    const batch = await importCsv(
      csvOf([
        ...chargeRows(new Date('2026-05-01T10:00:00Z'), 5, 1),
        ...chargeRows(new Date('2026-05-02T10:00:00Z'), 5, 2),
        ...driveRows(),
      ]),
    );
    expect(await dump()).not.toEqual(before);
    await imports.undo(batch.id);
    expect(await dump()).toEqual(before);
  });

  it('undo keeps a session a later Rivian sync merged into', async () => {
    const batch = await importCsv(csvOf(chargeRows(new Date('2026-05-02T10:00:00Z'), 5, 2)));
    await handle.db
      .update(chargingSessions)
      .set({ rivianTransactionId: 'tx9', source: 'live+rivian' })
      .where(eq(chargingSessions.importId, batch.id));
    await imports.undo(batch.id);
    const sessions = await handle.db.select().from(chargingSessions);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.importId).toBeNull();
    expect(await handle.db.select().from(chargingCurvePoints)).toHaveLength(0);
    // Nothing of the import's is left, so it reads as Rivian's alone.
    expect(sessions[0]).toMatchObject({
      source: 'rivian',
      rivianTransactionId: 'tx9',
      chargingSeconds: null,
      startSoc: null,
      endSoc: null,
      energyKwh: null,
      rangeAddedKm: null,
      avgPowerKw: null,
      maxPowerKw: null,
      lat: null,
      lon: null,
    });
    expect(await handle.db.select().from(importSessionFills)).toEqual([]);
  });

  it('undo keeps what Rivian gave a merged session, and drops a city only looked up', async () => {
    const batch = await importCsv(csvOf(chargeRows(new Date('2026-05-02T10:00:00Z'), 5, 2)));
    await handle.db
      .update(chargingSessions)
      .set({
        rivianTransactionId: 'tx9',
        source: 'live+rivian',
        vendor: 'RIVIAN',
        cost: '12.50',
        energyKwh: 44,
        city: 'Austin, TX',
        placesCheckedAt: new Date('2026-05-03T00:00:00Z'),
      })
      .where(eq(chargingSessions.importId, batch.id));
    await imports.undo(batch.id);
    const [session] = await handle.db.select().from(chargingSessions);
    expect(session).toMatchObject({
      vendor: 'RIVIAN',
      cost: '12.50',
      energyKwh: 44,
      city: null,
      placesCheckedAt: null,
      chargingSeconds: null,
    });
  });

  it('after a restart, an import left running is rolled back', async () => {
    const [batch] = await handle.db
      .insert(importBatches)
      .values({
        vehicleId: 'v1',
        format: 'electrafi',
        files: ['a.csv'],
        timeZone: 'UTC',
        fromDate: '2026-01-01',
        toDate: '2026-02-01',
      })
      .returning();
    await handle.db.insert(drives).values({
      vehicleId: 'v1',
      importId: batch!.id,
      startedAt: new Date('2026-01-05T00:00:00Z'),
    });
    await imports.recover();
    expect(await handle.db.select().from(drives)).toHaveLength(0);
    const [row] = await handle.db.select().from(importBatches);
    expect(row).toMatchObject({ status: 'failed' });
    expect(row!.error).toMatch(/restarted/);
  });

  it('runs one import at a time', async () => {
    const first = await upload(csvOf(driveRows()));
    const started = imports.start(first.id, selection);
    await started;
    const second = await upload(csvOf(driveRows('2026-10-31')));
    await expect(imports.start(second.id, selection)).rejects.toThrow(/already running/);
    await imports.idle();
  });

  describe('a Roamer export', () => {
    const exported = (vin = 'VIN1') =>
      roamerExport(
        {
          drive_sessions: [
            {
              started_at: '2026-03-01T10:00:00',
              ended_at: '2026-03-01T10:30:00',
              start_odometer: 100,
              end_odometer: 120,
              start_battery_level: 80,
              end_battery_level: 75,
              total_distance: 20,
              primary_drive_mode: 'everyday',
            },
          ],
          charging_sessions: [
            {
              started_at: '2026-03-01T12:00:00',
              ended_at: '2026-03-01T13:00:00',
              periods: [{ started_at: '2026-03-01T12:00:00Z', ended_at: '2026-03-01T12:50:00Z' }],
              start_battery_level: 50,
              end_battery_level: 60,
              total_energy_kwh: 11,
              pack_kwh: 10.5,
              thermal_kwh: 0.2,
              latitude: 33.1,
              longitude: -117.2,
            },
          ],
          vehicle_metrics: [
            {
              created_at: '2026-03-01T09:50:00+00:00',
              vehicle_mileage: 100000,
              gear_status: 'park',
              power_state: 'ready',
              battery_capacity: 110,
            },
            { created_at: '2026-03-01T10:01:00+00:00', gear_status: 'drive', power_state: 'go' },
            {
              created_at: '2026-03-01T10:30:00+00:00',
              gear_status: 'park',
              vehicle_mileage: 120000,
            },
            {
              created_at: '2026-03-01T12:10:00+00:00',
              battery_level: 52,
              charger_state: 'charging_active',
            },
          ],
          location_metrics: [
            {
              created_at: '2026-03-01T10:05:00+00:00',
              latitude: 33.1,
              longitude: -117.2,
              speed: 10,
            },
            {
              created_at: '2026-03-01T10:15:00+00:00',
              latitude: 33.2,
              longitude: -117.2,
              speed: 12,
            },
            // Parked: not a new place, and not moving.
            {
              created_at: '2026-03-01T10:40:00+00:00',
              latitude: 33.2,
              longitude: -117.2,
              speed: 0,
            },
          ],
          charging_metrics: [
            { created_at: '2026-03-01T12:05:00+00:00', state: 3, power_kw: 7.4 },
            { created_at: '2026-03-01T12:15:00+00:00', state: 3, power_kw: 7.5 },
          ],
        },
        vin,
      );
    const uploadArchive = (bytes: Buffer, draft?: string) =>
      imports.addFile(draft, 'roamer.zip', Readable.from(bytes), 'roamer');

    it('imports its drives, charges, routes and history', async () => {
      const draft = await uploadArchive(exported());
      expect(draft).toMatchObject({ format: 'roamer', files: ['roamer.zip'], vehicleIds: ['v1'] });
      const batch = await imports.start(draft.id, selection);
      await imports.idle();
      const [row] = await handle.db.select().from(importBatches);
      expect(row).toMatchObject({ id: batch.id, format: 'roamer', status: 'done' });
      expect(row!.counts).toMatchObject({ drives: 1, sessions: 1, locationPoints: 2 });

      const [drive] = await handle.db.select().from(drives);
      expect(drive).toMatchObject({
        startMileageM: 100000,
        endMileageM: 120000,
        distanceKm: 20,
        batteryCapacityKwh: 110,
        driveMode: 'everyday',
      });
      const points = await handle.db.select().from(locationPoints).orderBy(asc(locationPoints.ts));
      expect(points.map((p) => p.driveId)).toEqual([drive!.id, drive!.id]);
      expect(points[0]!.speedKmh).toBeCloseTo(36);

      const [session] = await handle.db.select().from(chargingSessions);
      expect(session).toMatchObject({
        source: 'roamer',
        chargingSeconds: 50 * 60,
        energyKwh: 11,
        packKwh: 10.5,
        startSoc: 50,
      });
      expect(session!.thermalKwh).toBeCloseTo(0.2);
      const curve = await handle.db
        .select()
        .from(chargingCurvePoints)
        .orderBy(asc(chargingCurvePoints.ts));
      expect(curve.map((p) => [p.source, p.powerKw, p.soc])).toEqual([
        ['roamer', expect.closeTo(7.4), 50],
        ['roamer', expect.closeTo(7.5), 52],
      ]);

      const gear = await changesBetween(
        handle.db,
        'v1',
        ['gearStatus'],
        new Date(0),
        new Date('2027-01-01'),
      );
      expect(gear.map((c) => c.value)).toEqual(['park', 'drive', 'park']);
    });

    it('brings who drove, where navigation was headed, and saved places, which undo keeps', async () => {
      const [mitch] = await handle.db
        .insert(drivers)
        .values({ vehicleId: 'v1', profileId: 'p-mitch', reportedName: 'Mitch V.' })
        .returning();
      await handle.db
        .insert(savedLocations)
        .values({ name: 'My house', lat: 33.0715, lon: -117.2566, radiusM: 150, isHome: true });
      const trip = (hour: number, driver: string) => ({
        started_at: `2026-03-01T${hour}:00:00`,
        ended_at: `2026-03-01T${hour}:30:00`,
        start_odometer: hour,
        end_odometer: hour + 10,
        total_distance: 10,
        primary_driver_profile: driver,
      });
      const draft = await uploadArchive(
        roamerExport(
          {
            drive_sessions: [trip(10, 'Mitch V.'), trip(12, 'Laura V.')],
            navigation_metrics: [
              {
                observed_at: '2026-03-01T12:05:00+00:00',
                navigation_active: true,
                destination_name: 'Beach',
                destination_latitude: 32.7,
                destination_longitude: -117.1,
              },
            ],
            saved_places: [
              {
                id: 'h',
                name: 'Home',
                latitude: 33.0715,
                longitude: -117.2566,
                radius_meters: 100,
              },
              { id: 'w', name: 'Work', latitude: 32.88, longitude: -117.22, radius_meters: 100 },
            ],
            rivian_favorites: [{ key: 'home', tagged_location_id: 'h' }],
          },
          'VIN1',
        ),
      );
      const preview = await imports.preview(draft.id, selection);
      expect(preview).toMatchObject({ placesNew: ['Work'], placesRecorded: 1 });
      expect(preview.drives.map((d) => d.driver)).toEqual(['Mitch V.', 'Laura V.']);

      const batch = await imports.start(draft.id, selection);
      await imports.idle();
      const [row] = await handle.db.select().from(importBatches);
      expect(row!.counts).toMatchObject({ drives: 2, places: 1 });

      const imported = await handle.db.select().from(drives).orderBy(asc(drives.startedAt));
      const laura = (await handle.db.select().from(drivers)).find((d) => d.id !== mitch!.id)!;
      expect(laura).toMatchObject({ reportedName: 'Laura V.', profileId: null });
      expect(imported.map((d) => [d.driverId, d.driverSource])).toEqual([
        [mitch!.id, 'profile'],
        [laura.id, 'profile'],
      ]);
      expect(imported.map((d) => d.destinationName)).toEqual([null, 'Beach']);
      const places = await handle.db.select().from(savedLocations).orderBy(asc(savedLocations.id));
      expect(places.map((p) => [p.name, p.isHome])).toEqual([
        ['My house', true],
        ['Work', false],
      ]);

      // The drives go; the people and places stay.
      await imports.undo(batch.id);
      expect(await handle.db.select().from(drives)).toHaveLength(0);
      expect((await handle.db.select().from(drivers)).map((d) => d.id)).toEqual([
        mitch!.id,
        laura.id,
      ]);
      expect((await handle.db.select().from(savedLocations)).map((p) => p.name)).toEqual([
        'My house',
        'Work',
      ]);
    });

    it('has only the vehicles it holds data for to import to', async () => {
      const draft = await uploadArchive(exported('SOMEONE-ELSE'));
      expect(draft.vehicleIds).toEqual([]);
      await expect(imports.preview(draft.id, selection)).rejects.toThrow(
        /no data for that vehicle/,
      );
    });

    it('is one file: another upload replaces it, and nothing is added to it', async () => {
      const first = await uploadArchive(exported());
      await expect(uploadArchive(exported(), first.id)).rejects.toThrow(/single file/);
      await expect(
        imports.addFile(first.id, 'export.csv', Readable.from(csvOf(driveRows())), 'electrafi'),
      ).rejects.toThrow(/one kind of export/);
      const second = await uploadArchive(exported());
      expect((await imports.list()).draft?.id).toBe(second.id);
      await expect(uploadArchive(Buffer.from(csvOf(driveRows())))).rejects.toThrow(/Roamer export/);
    });

    it('adds the breakdown to a charge Rivian recorded without one', async () => {
      await handle.db.insert(chargingSessions).values({
        vehicleId: 'v1',
        source: 'rivian',
        rivianTransactionId: 'tx1',
        startedAt: new Date('2026-03-01T12:00:30Z'),
        endedAt: new Date('2026-03-01T13:00:00Z'),
        energyKwh: 11.2,
      });
      const [before] = await handle.db.select().from(chargingSessions);
      const draft = await uploadArchive(exported());
      const preview = await imports.preview(draft.id, selection);
      expect(preview.charges[0]).toMatchObject({ status: 'enrich' });
      expect(preview.charges[0]!.adds).toContain('breakdown');
      expect(preview.charges[0]!.adds).not.toContain('energy');
      const batch = await imports.start(draft.id, selection);
      await imports.idle();
      const [session] = await handle.db.select().from(chargingSessions);
      expect(session).toMatchObject({ source: 'rivian', energyKwh: 11.2, packKwh: 10.5 });
      expect(await handle.db.select().from(chargingCurvePoints)).toHaveLength(2);

      // Undo puts the charge back as Rivian had it.
      await imports.undo(batch.id);
      const [after] = await handle.db.select().from(chargingSessions);
      expect(after).toEqual({ ...before!, id: after!.id });
      expect(await handle.db.select().from(chargingCurvePoints)).toHaveLength(0);
      expect(await handle.db.select().from(importSessionFills)).toHaveLength(0);
    });
  });
});
