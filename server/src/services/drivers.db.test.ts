/**
 * Integration tests against a real Postgres. Skipped unless
 * TEST_DATABASE_URL points at a disposable database (tables are truncated).
 */
import { asc, eq } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, runMigrations } from '../db/client.js';
import { drivers, drives, vehicles } from '../db/schema.js';
import { silentLogger } from '../logger.js';
import { RVM_ACTIVE_PROFILE } from '../rivian/parallax/index.js';
import { b64, string } from '../testing/protobuf.js';
import { Drivers } from './drivers.js';
import { HistoryKeys } from './history-keys.js';
import { ParallaxArchive } from './parallax-archive.js';

const url = process.env.TEST_DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));

const ALICE = '11111111-1111-4111-8111-111111111111';
const BEN = '22222222-2222-4222-8222-222222222222';
const START = Date.parse('2026-10-20T08:00:00Z');
const at = (seconds: number) => new Date(START + seconds * 1000);

describe.skipIf(!url)('Drivers with Postgres', () => {
  let handle: ReturnType<typeof createDb>;
  let archive: ParallaxArchive;
  let service: Drivers;

  /** The vehicle reports a profile (null: none) at `seconds` from START. */
  const report = (profileId: string | null, seconds: number) =>
    archive.ingest('v1', {
      rvm: RVM_ACTIVE_PROFILE,
      payload: profileId ? b64(string(1, profileId)) : '',
      timestamp: at(seconds).getTime(),
    });

  const drive = async (startSeconds: number, ended = true) => {
    const [row] = await handle.db
      .insert(drives)
      .values({
        vehicleId: 'v1',
        startedAt: at(startSeconds),
        endedAt: ended ? at(startSeconds + 1200) : null,
      })
      .returning({ id: drives.id });
    return row!.id;
  };

  const driveDriver = async (id: number) => {
    const [row] = await handle.db
      .select({ driverId: drives.driverId, source: drives.driverSource })
      .from(drives)
      .where(eq(drives.id, id));
    return row!;
  };

  const driverId = async (profileId: string) => {
    const [row] = await handle.db
      .select({ id: drivers.id })
      .from(drivers)
      .where(eq(drivers.profileId, profileId));
    return row?.id ?? null;
  };

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
    archive = new ParallaxArchive(handle.db, new HistoryKeys(handle.db), silentLogger);
    service = new Drivers(handle.db, archive, silentLogger, 60_000);
  });

  it('assigns the profile active as the drive started, creating its driver', async () => {
    await report(ALICE, -3600);
    const id = await drive(0);
    await service.assign(id);

    const alice = await driverId(ALICE);
    expect(alice).not.toBeNull();
    expect(await driveDriver(id)).toEqual({ driverId: alice, source: 'profile' });
    const [row] = await handle.db.select().from(drivers);
    expect(row!.lastSeenAt).toEqual(at(-3600));
  });

  it('finds a driver seen before without spending ids, keeping the latest time', async () => {
    await service.noteProfile('v1', ALICE, at(10));
    await service.noteProfile('v1', ALICE, at(5));
    await service.driverFor('v1', ALICE, null);
    await service.noteProfile('v1', BEN, at(20));

    const rows = await handle.db
      .select({ id: drivers.id, profileId: drivers.profileId, lastSeenAt: drivers.lastSeenAt })
      .from(drivers)
      .orderBy(asc(drivers.id));
    expect(rows).toEqual([
      { id: 1, profileId: ALICE, lastSeenAt: at(10) },
      { id: 2, profileId: BEN, lastSeenAt: at(20) },
    ]);
  });

  it('takes a profile picked just after the start, but not one picked later', async () => {
    await report(ALICE, -600);
    await report(BEN, 30);
    const switched = await drive(0);
    await service.assign(switched);
    expect((await driveDriver(switched)).driverId).toBe(await driverId(BEN));

    await report(ALICE, 5000);
    await report(BEN, 5000 + 120);
    const late = await drive(5000);
    await service.assign(late);
    expect((await driveDriver(late)).driverId).toBe(await driverId(ALICE));
  });

  it('records that nobody is known without an active profile', async () => {
    const before = await drive(0);
    await service.assign(before);
    expect(await driveDriver(before)).toEqual({ driverId: null, source: 'none' });

    await report(ALICE, 7000);
    await report(null, 7900);
    const noProfile = await drive(8000);
    await service.assign(noProfile);
    expect(await driveDriver(noProfile)).toEqual({ driverId: null, source: 'none' });
  });

  it('never replaces a driver the user picked', async () => {
    await report(ALICE, -60);
    const [picked] = await handle.db
      .insert(drivers)
      .values({ vehicleId: 'v1', name: 'Guest' })
      .returning({ id: drivers.id });
    const id = await drive(0);
    await handle.db
      .update(drives)
      .set({ driverId: picked!.id, driverSource: 'manual' })
      .where(eq(drives.id, id));
    await service.assign(id);
    expect(await driveDriver(id)).toEqual({ driverId: picked!.id, source: 'manual' });
  });

  it('catches up on ended drives never assigned, leaving open ones to the detector', async () => {
    await report(ALICE, -60);
    const older = await drive(0);
    const newer = await drive(3600);
    const open = await drive(7200, false);
    service.start();
    await waitFor(async () => (await driveDriver(older)).source !== null);
    await service.idle();

    const alice = await driverId(ALICE);
    expect(await driveDriver(older)).toEqual({ driverId: alice, source: 'profile' });
    expect(await driveDriver(newer)).toEqual({ driverId: alice, source: 'profile' });
    expect(await driveDriver(open)).toEqual({ driverId: null, source: null });

    service.enqueue(open);
    await service.idle();
    expect(await driveDriver(open)).toEqual({ driverId: alice, source: 'profile' });
    service.stop();
  });

  it('keeps the reported name for the profile active once it settles', async () => {
    await service.noteProfile('v1', ALICE, at(0));
    service.noteName('v1', 'Driver');
    // The name for a switch can come before the profile does.
    service.noteName('v1', 'Ben');
    await service.noteProfile('v1', BEN, at(2));
    // An older report arriving late doesn't count as the current profile.
    await service.noteProfile('v1', ALICE, at(1));
    await service.flushNames();

    const rows = await handle.db
      .select({
        profileId: drivers.profileId,
        reportedName: drivers.reportedName,
        lastSeenAt: drivers.lastSeenAt,
      })
      .from(drivers)
      .orderBy(asc(drivers.id));
    expect(rows).toEqual([
      { profileId: ALICE, reportedName: null, lastSeenAt: at(1) },
      { profileId: BEN, reportedName: 'Ben', lastSeenAt: at(2) },
    ]);
  });

  it('takes over a driver an import made from the name, with its drives', async () => {
    const [imported] = await handle.db
      .insert(drivers)
      .values({ vehicleId: 'v1', reportedName: 'Ben V.', name: 'Benny' })
      .returning({ id: drivers.id });
    const id = await drive(0);
    await handle.db
      .update(drives)
      .set({ driverId: imported!.id, driverSource: 'profile' })
      .where(eq(drives.id, id));

    await service.noteProfile('v1', BEN, at(10));
    service.noteName('v1', ' ben v. ');
    await service.flushNames();

    const rows = await handle.db
      .select({ id: drivers.id, profileId: drivers.profileId, name: drivers.name })
      .from(drivers);
    expect(rows).toEqual([{ id: await driverId(BEN), profileId: BEN, name: 'Benny' }]);
    expect(await driveDriver(id)).toEqual({ driverId: await driverId(BEN), source: 'profile' });
  });
});

async function waitFor(check: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > until) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}
