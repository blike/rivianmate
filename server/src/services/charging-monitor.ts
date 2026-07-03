import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { chargingSessions, wallboxReadings, wallboxes } from "../db/schema.js";
import type { RivianApi } from "../rivian/client.js";
import {
  LiveSessionData,
  RivianRateLimitError,
  RivianUnauthenticatedError,
} from "../rivian/types.js";
import type { LiveBus } from "./live-bus.js";

const PLUGGED_INTERVAL_MS = 30_000;
const IDLE_INTERVAL_MS = 15 * 60_000;
const MAX_BACKOFF_MS = 900_000;

interface OpenSession {
  id: number;
  powerSum: number;
  powerCount: number;
  maxPowerKw: number;
}

/**
 * Polls the live charging session (30s while plugged in, 15min idle) and the
 * registered wallboxes, persisting session rows and wallbox readings.
 */
export class ChargingMonitor {
  private timer?: NodeJS.Timeout;
  private running = false;
  private pluggedIn = false;
  private errorCount = 0;
  private openSessions = new Map<string, OpenSession>();
  private lastWallboxReading = new Map<string, string>();
  /** vehicleId -> vin */
  private vehicles = new Map<string, string>();
  private latestLocation = new Map<string, { lat: number; lon: number }>();

  onUnauthenticated?: () => void;

  constructor(
    private readonly db: Db,
    private readonly api: RivianApi,
    private readonly bus: LiveBus,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  setVehicles(vehicles: { id: string; vin: string }[]): void {
    this.vehicles = new Map(vehicles.map((v) => [v.id, v.vin]));
  }

  noteLocation(vehicleId: string, lat: number, lon: number): void {
    this.latestLocation.set(vehicleId, { lat, lon });
  }

  /** Driven by the vehicle monitor from chargerStatus updates. */
  setPluggedIn(pluggedIn: boolean): void {
    if (this.pluggedIn === pluggedIn) return;
    this.pluggedIn = pluggedIn;
    if (this.running) this.schedule(pluggedIn ? 0 : this.interval());
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.closeDanglingSessions();
    this.schedule(0);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private interval(): number {
    return this.pluggedIn ? PLUGGED_INTERVAL_MS : IDLE_INTERVAL_MS;
  }

  private schedule(delayMs: number): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.tick();
    }, delayMs);
  }

  private async tick(): Promise<void> {
    try {
      for (const [vehicleId, vin] of this.vehicles) {
        const session = await this.api.getLiveSessionData(vin);
        await this.processSession(vehicleId, session);
        this.bus.emitChargingSession(vehicleId, session);
      }
      await this.pollWallboxes();
      this.errorCount = 0;
      this.schedule(this.interval());
    } catch (err) {
      if (err instanceof RivianUnauthenticatedError) {
        this.log("charging poll unauthenticated");
        this.stop();
        this.onUnauthenticated?.();
        return;
      }
      this.errorCount += 1;
      const backoff = Math.min(
        this.interval() * 2 ** this.errorCount,
        MAX_BACKOFF_MS,
      );
      const kind = err instanceof RivianRateLimitError ? "rate limited" : "error";
      this.log(`charging poll ${kind}: ${(err as Error).message}; retry in ${Math.round(backoff / 1000)}s`);
      this.schedule(backoff);
    }
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
            chargerType: session.isRivianCharger ? "rivian_charger" : "other",
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
      return;
    }

    if (open) {
      await this.db
        .update(chargingSessions)
        .set({ endedAt: new Date() })
        .where(eq(chargingSessions.id, open.id));
      this.openSessions.delete(vehicleId);
      this.log(`charging session ended for ${vehicleId}`);
    }
  }

  private async pollWallboxes(): Promise<void> {
    const boxes = await this.api.getRegisteredWallboxes();
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
      .where(
        and(isNull(chargingSessions.endedAt)),
      );
  }
}

export function isActiveSession(session: LiveSessionData | null): boolean {
  if (!session) return false;
  const state = session.vehicleChargerState?.value;
  if (typeof state === "string") {
    return ["charging_active", "charging_connecting", "charging_ready"].includes(
      state,
    );
  }
  return session.startTime != null;
}

function num(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
