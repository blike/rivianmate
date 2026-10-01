import { eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  chargingCurvePoints,
  chargingSessions,
  wallboxReadings,
  wallboxes,
} from "../db/schema.js";
import type { RivianApi } from "../rivian/client.js";
import {
  LiveSessionData,
  RivianRateLimitError,
  RivianUnauthenticatedError,
} from "../rivian/types.js";
import type { LiveBus } from "./live-bus.js";

/** REST safety net: only while plugged in and the push feed has gone quiet. */
const SAFETY_NET_INTERVAL_MS = 5 * 60_000;
const PUSH_STALE_MS = 5 * 60_000;
/** Wallbox readings are only interesting while a vehicle is plugged in. */
const WALLBOX_INTERVAL_MS = 15 * 60_000;

interface OpenSession {
  id: number;
  powerSum: number;
  powerCount: number;
  maxPowerKw: number;
}

/**
 * Tracks charging sessions from the live `chargingSession` push feed and
 * persists session rows and wallbox readings.
 *
 * Nothing here polls on a fixed schedule while the vehicle is unplugged.
 * While plugged in, a slow REST check runs only if the push feed has been
 * silent for a while (e.g. the socket is down or Rivian refused the
 * charging subscription).
 */
export class ChargingMonitor {
  private timer?: NodeJS.Timeout;
  private running = false;
  private pluggedIn = new Set<string>();
  private lastPushAt = new Map<string, number>();
  private lastWallboxPollAt = 0;
  private openSessions = new Map<string, OpenSession>();
  private lastWallboxReading = new Map<string, string>();
  /** Per-vehicle serialization so pushes and polls never race an insert. */
  private chains = new Map<string, Promise<void>>();
  /** Rivian vehicle ids (from getUserInfo, not VINs). */
  private vehicles = new Set<string>();
  private latestLocation = new Map<string, { lat: number; lon: number }>();

  /** Rivian rejected credentials even after a session rotation. */
  onAuthFailure?: () => void;
  /** A REST call succeeded with the current credentials. */
  onAuthOk?: () => void;
  /** A recorded session just ended (e.g. to sync Rivian's history). */
  onSessionEnded?: (vehicleId: string) => void;

  constructor(
    private readonly db: Db,
    private readonly api: RivianApi,
    private readonly bus: LiveBus,
    private readonly log: (msg: string) => void = () => {},
    private readonly now: () => number = Date.now,
  ) {}

  setVehicles(vehicleIds: string[]): void {
    this.vehicles = new Set(vehicleIds);
  }

  noteLocation(vehicleId: string, lat: number, lon: number): void {
    this.latestLocation.set(vehicleId, { lat, lon });
  }

  /** Driven by the vehicle monitor from chargerStatus updates. */
  setPluggedIn(vehicleId: string, pluggedIn: boolean): void {
    if (this.pluggedIn.has(vehicleId) === pluggedIn) return;
    if (pluggedIn) {
      this.pluggedIn.add(vehicleId);
      // Give the push feed a head start before any REST check.
      this.lastPushAt.set(vehicleId, this.lastPushAt.get(vehicleId) ?? this.now());
    } else {
      this.pluggedIn.delete(vehicleId);
      // Unplugged: whatever was open is over.
      void this.enqueue(vehicleId, () => this.processSession(vehicleId, null));
    }
    this.reschedule();
  }

  /** Live session data pushed over the WebSocket. */
  ingest(vehicleId: string, session: LiveSessionData | null): Promise<void> {
    this.lastPushAt.set(vehicleId, this.now());
    return this.enqueue(vehicleId, async () => {
      await this.processSession(vehicleId, session);
      this.bus.emitChargingSession(vehicleId, session);
    });
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.closeDanglingSessions();
    // One wallbox refresh at startup keeps names/firmware current.
    try {
      await this.pollWallboxes();
    } catch (err) {
      this.handleError(err, "wallbox refresh");
    }
    this.reschedule();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private reschedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.running || this.pluggedIn.size === 0) return;
    this.timer = setTimeout(() => void this.tick(), SAFETY_NET_INTERVAL_MS);
  }

  private async tick(): Promise<void> {
    this.timer = undefined;
    try {
      for (const vehicleId of this.pluggedIn) {
        if (!this.vehicles.has(vehicleId)) continue;
        const lastPush = this.lastPushAt.get(vehicleId) ?? 0;
        if (this.now() - lastPush < PUSH_STALE_MS) continue;
        const session = await this.api.getLiveSessionData(vehicleId);
        this.onAuthOk?.();
        await this.enqueue(vehicleId, async () => {
          await this.processSession(vehicleId, session);
          this.bus.emitChargingSession(vehicleId, session);
        });
      }
      if (this.now() - this.lastWallboxPollAt >= WALLBOX_INTERVAL_MS) {
        await this.pollWallboxes();
      }
    } catch (err) {
      this.handleError(err, "charging check");
    }
    this.reschedule();
  }

  private handleError(err: unknown, what: string): void {
    if (err instanceof RivianUnauthenticatedError) {
      this.log(`${what}: credentials rejected`);
      this.onAuthFailure?.();
      return;
    }
    const kind = err instanceof RivianRateLimitError ? "rate limited" : "failed";
    this.log(`${what} ${kind}: ${(err as Error).message}`);
  }

  private enqueue(vehicleId: string, task: () => Promise<void>): Promise<void> {
    const prev = this.chains.get(vehicleId) ?? Promise.resolve();
    const next = prev.then(task).catch((err: unknown) => {
      this.log(`charging persistence error: ${(err as Error).message}`);
    });
    this.chains.set(vehicleId, next);
    return next;
  }

  private async processSession(
    vehicleId: string,
    session: LiveSessionData | null,
  ): Promise<void> {
    const active = isActiveSession(session);
    const open = this.openSessions.get(vehicleId);

    if (active && session) {
      const power = num(session.power?.value);
      if (!open) {
        const loc = this.latestLocation.get(vehicleId);
        const inserted = await this.db
          .insert(chargingSessions)
          .values({
            vehicleId,
            startedAt: session.startTime ? new Date(session.startTime) : new Date(),
            chargerId: session.chargerId,
            chargerType:
              session.isRivianCharger == null
                ? null
                : session.isRivianCharger
                  ? "rivian_charger"
                  : "other",
            isRivianCharger: session.isRivianCharger,
            startSoc: num(session.soc?.value),
            currency: session.currentCurrency,
            lat: loc?.lat,
            lon: loc?.lon,
          })
          .returning({ id: chargingSessions.id });
        this.openSessions.set(vehicleId, {
          id: inserted[0]!.id,
          powerSum: power ?? 0,
          powerCount: power != null ? 1 : 0,
          maxPowerKw: power ?? 0,
        });
        this.log(`charging session started for ${vehicleId}`);
        await this.recordCurve(inserted[0]!.id, session);
        return;
      }

      if (power != null) {
        open.powerSum += power;
        open.powerCount += 1;
        open.maxPowerKw = Math.max(open.maxPowerKw, power);
      }
      await this.db
        .update(chargingSessions)
        .set({
          endSoc: num(session.soc?.value),
          energyKwh: num(session.totalChargedEnergy?.value),
          rangeAddedKm: num(session.rangeAddedThisSession?.value),
          avgPowerKw: open.powerCount
            ? open.powerSum / open.powerCount
            : null,
          maxPowerKw: open.maxPowerKw,
          cost:
            session.currentPrice != null
              ? String(session.currentPrice)
              : undefined,
          rawFinal: session,
        })
        .where(eq(chargingSessions.id, open.id));
      await this.recordCurve(open.id, session);
      return;
    }

    if (open) {
      await this.db
        .update(chargingSessions)
        .set({ endedAt: new Date() })
        .where(eq(chargingSessions.id, open.id));
      this.openSessions.delete(vehicleId);
      this.log(`charging session ended for ${vehicleId}`);
      this.onSessionEnded?.(vehicleId);
    }
  }

  /**
   * Stores curve samples: the subscription's chart points when present,
   * plus the current reading. Repeats of the same timestamp are ignored.
   */
  private async recordCurve(sessionId: number, session: LiveSessionData): Promise<void> {
    const samples = [...(session.chart ?? [])];
    const power = num(session.power?.value);
    const soc = num(session.soc?.value);
    if (power != null || soc != null) {
      samples.push({
        ts: session.power?.updatedAt ?? session.soc?.updatedAt ?? new Date().toISOString(),
        powerKw: power,
        soc,
      });
    }
    const rows = samples
      .filter((s) => !Number.isNaN(Date.parse(s.ts)))
      .map((s) => ({ sessionId, ts: new Date(s.ts), powerKw: s.powerKw, soc: s.soc }));
    if (rows.length === 0) return;
    await this.db.insert(chargingCurvePoints).values(rows).onConflictDoNothing();
  }

  private async pollWallboxes(): Promise<void> {
    this.lastWallboxPollAt = this.now();
    const boxes = await this.api.getRegisteredWallboxes();
    this.onAuthOk?.();
    for (const box of boxes) {
      await this.db
        .insert(wallboxes)
        .values({
          wallboxId: box.wallboxId,
          name: box.name,
          model: box.model,
          serialNumber: box.serialNumber,
          softwareVersion: box.softwareVersion,
          maxAmps: box.maxAmps,
          maxVoltage: box.maxVoltage,
          maxPower: box.maxPower,
          latitude: box.latitude,
          longitude: box.longitude,
          linked: box.linked,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: wallboxes.wallboxId,
          set: {
            name: box.name,
            softwareVersion: box.softwareVersion,
            linked: box.linked,
            updatedAt: new Date(),
          },
        });

      const signature = `${box.chargingStatus}|${box.power}|${box.currentVoltage}|${box.currentAmps}`;
      if (this.lastWallboxReading.get(box.wallboxId) === signature) continue;
      this.lastWallboxReading.set(box.wallboxId, signature);
      await this.db.insert(wallboxReadings).values({
        wallboxId: box.wallboxId,
        ts: new Date(),
        chargingStatus: box.chargingStatus,
        power: box.power,
        currentVoltage: box.currentVoltage,
        currentAmps: box.currentAmps,
      });
    }
  }

  private async closeDanglingSessions(): Promise<void> {
    await this.db
      .update(chargingSessions)
      .set({ endedAt: new Date() })
      .where(isNull(chargingSessions.endedAt));
  }
}

const ACTIVE_CHARGER_STATES = new Set([
  "charging_active",
  "charging_connecting",
  "charging_ready",
  "charging",
]);

export function isActiveSession(session: LiveSessionData | null): boolean {
  if (!session) return false;
  const state = session.vehicleChargerState?.value;
  if (typeof state === "string") {
    return ACTIVE_CHARGER_STATES.has(state.toLowerCase());
  }
  return session.startTime != null;
}

function num(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
