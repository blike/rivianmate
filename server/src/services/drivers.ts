import { and, asc, desc, eq, isNotNull, isNull, ne, notInArray, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { drivers, drives } from '../db/schema.js';
import { type Logger, silentLogger } from '../logger.js';
import { RVM_ACTIVE_PROFILE, decodeActiveProfile } from '../rivian/parallax/index.js';
import type { ParallaxArchive } from './parallax-archive.js';

/**
 * A profile the vehicle switches to this soon after a drive starts is the
 * drive's driver: someone who unlocked with another key and then picked
 * their own profile.
 */
export const DRIVER_SETTLE_MS = 60_000;
/**
 * The driver's name and profile arrive on separate feeds, in either order;
 * a new name is matched to whichever profile is active this long after it.
 */
const NAME_SETTLE_MS = 15_000;
/** Drives assigned per database read while catching up on older ones. */
const BACKLOG_BATCH = 200;

export type DriverSource = 'profile' | 'manual' | 'none';

/**
 * Each of a vehicle's drivers by id, as shown: the user's name for them,
 * else the one the vehicle reported, else "Driver N", numbered in the
 * order they were first seen.
 */
export async function driverNames(db: Db, vehicleId: string): Promise<Map<number, string>> {
  const rows = await db
    .select({ id: drivers.id, name: drivers.name, reportedName: drivers.reportedName })
    .from(drivers)
    .where(eq(drivers.vehicleId, vehicleId))
    .orderBy(asc(drivers.createdAt), asc(drivers.id));
  return new Map(
    rows.map((r, i) => [r.id, r.name?.trim() || r.reportedName?.trim() || `Driver ${i + 1}`]),
  );
}

interface ActiveProfile {
  profileId: string | null;
  /** Rivian's time for the report (ms). */
  at: number;
}

/**
 * Who drives each vehicle, and who drove each drive.
 *
 * The vehicle reports its active driver profile (an opaque id) on Parallax
 * and the profile's name on the legacy feed. Each profile seen becomes a
 * driver, named by the user or else by the name the vehicle reported. A
 * drive's driver is the profile active as it started, from the archive, so
 * drives delivered late and drives from before this existed are assigned
 * the same way. A driver the user picked for a drive is never replaced.
 */
export class Drivers {
  private readonly current = new Map<string, ActiveProfile>();
  private readonly nameTimers = new Map<string, NodeJS.Timeout>();
  /** Names waiting to settle, per vehicle. */
  private readonly pendingNames = new Map<string, string>();
  private queue: number[] = [];
  private running = false;
  private stopped = true;
  /** Drives whose assignment failed, left alone until the next start. */
  private readonly failed = new Set<number>();

  constructor(
    private readonly db: Db,
    private readonly archive: Pick<ParallaxArchive, 'latestAtOrBefore'>,
    private readonly log: Logger = silentLogger,
    private readonly nameSettleMs = NAME_SETTLE_MS,
  ) {}

  /** Starts assigning drives, beginning with ended drives never assigned. */
  start(): void {
    this.stopped = false;
    this.failed.clear();
    void this.catchUp().catch((err: unknown) =>
      this.log.warn({ err }, 'could not list drives to assign drivers to'),
    );
  }

  stop(): void {
    this.stopped = true;
    this.queue = [];
    for (const timer of this.nameTimers.values()) clearTimeout(timer);
    this.nameTimers.clear();
    this.pendingNames.clear();
  }

  /** The vehicle reported its active profile; null when none is active. */
  async noteProfile(vehicleId: string, profileId: string | null, at: Date): Promise<void> {
    const held = this.current.get(vehicleId);
    if (!held || at.getTime() >= held.at) {
      this.current.set(vehicleId, { profileId, at: at.getTime() });
    }
    if (profileId) await this.driverFor(vehicleId, profileId, at);
  }

  /** The vehicle reported the active driver's name; kept for the profile active once it settles. */
  noteName(vehicleId: string, name: string | null): void {
    clearTimeout(this.nameTimers.get(vehicleId));
    this.nameTimers.delete(vehicleId);
    const trimmed = name?.trim();
    if (!trimmed) {
      this.pendingNames.delete(vehicleId);
      return;
    }
    this.pendingNames.set(vehicleId, trimmed);
    const timer = setTimeout(() => {
      this.nameTimers.delete(vehicleId);
      this.saveName(vehicleId).catch((err: unknown) =>
        this.log.error({ err, vehicleId }, 'saving the driver name failed'),
      );
    }, this.nameSettleMs);
    timer.unref?.();
    this.nameTimers.set(vehicleId, timer);
  }

  /** Assigns a drive's driver (again), unless the user picked one. */
  enqueue(driveId: number): void {
    if (this.stopped || this.failed.has(driveId) || this.queue.includes(driveId)) return;
    this.queue.push(driveId);
    void this.drain();
  }

  /** Resolves once the queue is empty (for tests). */
  async idle(): Promise<void> {
    while (this.running || this.queue.length > 0) await new Promise((r) => setTimeout(r, 10));
  }

  /** Saves names waiting to settle now (for tests). */
  async flushNames(): Promise<void> {
    const vehicleIds = [...this.nameTimers.keys()];
    for (const vehicleId of vehicleIds) clearTimeout(this.nameTimers.get(vehicleId));
    this.nameTimers.clear();
    await Promise.all(vehicleIds.map((vehicleId) => this.saveName(vehicleId)));
  }

  private async saveName(vehicleId: string): Promise<void> {
    const name = this.pendingNames.get(vehicleId);
    this.pendingNames.delete(vehicleId);
    const profileId = this.current.get(vehicleId)?.profileId;
    if (!name || !profileId) return;
    await this.driverFor(vehicleId, profileId, null);
    await this.db
      .update(drivers)
      .set({ reportedName: name })
      .where(and(eq(drivers.vehicleId, vehicleId), eq(drivers.profileId, profileId)));
  }

  /** The driver for a profile, created the first time it's seen. */
  async driverFor(vehicleId: string, profileId: string, seenAt: Date | null): Promise<number> {
    const [row] = await this.db
      .insert(drivers)
      .values({ vehicleId, profileId, lastSeenAt: seenAt })
      .onConflictDoUpdate({
        target: [drivers.vehicleId, drivers.profileId],
        // greatest() skips nulls, so an unknown time never clears a known one.
        set: { lastSeenAt: sql`greatest(${drivers.lastSeenAt}, excluded.last_seen_at)` },
      })
      .returning({ id: drivers.id });
    return row!.id;
  }

  /** Who drove: the profile active as the drive started, if any. */
  async assign(driveId: number): Promise<void> {
    const [drive] = await this.db
      .select({
        vehicleId: drives.vehicleId,
        startedAt: drives.startedAt,
        driverSource: drives.driverSource,
      })
      .from(drives)
      .where(eq(drives.id, driveId));
    if (!drive || drive.driverSource === 'manual') return;

    const report = await this.archive.latestAtOrBefore(
      drive.vehicleId,
      RVM_ACTIVE_PROFILE,
      new Date(drive.startedAt.getTime() + DRIVER_SETTLE_MS),
    );
    const profileId = report ? decodeActiveProfile(report.payload) : null;
    const driverId = profileId
      ? await this.driverFor(drive.vehicleId, profileId, report!.at)
      : null;
    const source: DriverSource = profileId ? 'profile' : 'none';
    await this.db
      .update(drives)
      .set({ driverId, driverSource: source })
      .where(
        and(
          eq(drives.id, driveId),
          or(isNull(drives.driverSource), ne(drives.driverSource, 'manual')),
        ),
      );
  }

  /** Ended drives never assigned, newest first, a batch at a time until none are left. */
  private async catchUp(): Promise<void> {
    let total = 0;
    while (!this.stopped) {
      const skip = [...this.failed];
      const pending = await this.db
        .select({ id: drives.id })
        .from(drives)
        .where(
          and(
            isNull(drives.driverSource),
            isNotNull(drives.endedAt),
            skip.length ? notInArray(drives.id, skip) : undefined,
          ),
        )
        .orderBy(desc(drives.startedAt))
        .limit(BACKLOG_BATCH);
      if (pending.length === 0) break;
      for (const { id } of pending) {
        if (this.stopped) return;
        await this.run(id);
      }
      total += pending.length;
    }
    if (total > 0) this.log.info(`assigned drivers to ${total} earlier drive(s)`);
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (!this.stopped && this.queue.length > 0) await this.run(this.queue.shift()!);
    } finally {
      this.running = false;
    }
  }

  private async run(driveId: number): Promise<void> {
    try {
      await this.assign(driveId);
    } catch (err) {
      this.failed.add(driveId);
      this.log.error({ err, driveId }, 'assigning the driver failed');
    }
  }
}
