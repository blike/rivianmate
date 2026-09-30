import type { Db } from "../db/client.js";
import { vehicles as vehiclesTable } from "../db/schema.js";
import type { RivianApi } from "../rivian/client.js";
import type { VehicleStateStream } from "../rivian/subscription.js";
import {
  RivianTokens,
  RivianUnauthenticatedError,
  VehicleState,
} from "../rivian/types.js";
import { ChargingMonitor } from "./charging-monitor.js";
import { DriveDetector } from "./drive-detector.js";
import type { LiveBus } from "./live-bus.js";
import { SnapshotWriter } from "./snapshot-writer.js";
import { mergeVehicleState, stateLocation, stateString } from "./state-utils.js";
import type { TokenStore } from "./token-store.js";

const WS_DOWN_POLL_AFTER_MS = 5 * 60_000;
/** Fallback polling only runs while the socket is down, and slowly. */
const FALLBACK_POLL_AWAKE_MS = 5 * 60_000;
const FALLBACK_POLL_ASLEEP_MS = 30 * 60_000;
/**
 * Consecutive credential rejections (each after a session rotation) before
 * we stop and ask for a re-login. One-off rejections are common and
 * recoverable; giving up on the first one forces needless re-logins.
 */
const AUTH_FAILURE_THRESHOLD = 3;
const ASLEEP_POWER_STATES = new Set(["sleep", "standby"]);

export interface MonitorDiagnostics {
  running: boolean;
  streamConnected: boolean;
  fallbackPolling: boolean;
  consecutiveAuthFailures: number;
}

export interface MonitoredVehicle {
  id: string;
  vin: string;
  name: string | null;
  make: string | null;
  model: string | null;
  modelYear: number | null;
}

export interface RivianConnection {
  api: RivianApi;
  stream: VehicleStateStream;
}

/**
 * Owns the Rivian connection lifecycle: discovers vehicles, keeps a merged
 * full-state cache fed by the subscription, and fans out to persistence,
 * drive detection, charging polling, and the live bus.
 */
export class VehicleMonitor {
  private connection?: RivianConnection;
  private vehicles: MonitoredVehicle[] = [];
  private states = new Map<string, VehicleState>();
  private vinToId = new Map<string, string>();
  private snapshotWriter: SnapshotWriter;
  private driveDetector: DriveDetector;
  private chargingMonitor?: ChargingMonitor;
  private wsDownTimer?: NodeJS.Timeout;
  private fallbackPollTimer?: NodeJS.Timeout;
  private running = false;
  private streamConnected = false;
  private authFailures = 0;
  /** Bumped on every start/stop so a superseded start() bails out. */
  private generation = 0;

  constructor(
    private readonly db: Db,
    private readonly tokenStore: TokenStore,
    private readonly bus: LiveBus,
    private readonly createConnection: (tokens: RivianTokens) => RivianConnection,
    private readonly log: (msg: string) => void = console.log,
  ) {
    this.snapshotWriter = new SnapshotWriter(db);
    this.driveDetector = new DriveDetector(db, (vehicleId, driveId) =>
      this.snapshotWriter.setCurrentDrive(vehicleId, driveId),
    );
  }

  get isRunning(): boolean {
    return this.running;
  }

  getVehicles(): MonitoredVehicle[] {
    return this.vehicles;
  }

  getState(vehicleId: string): VehicleState | undefined {
    return this.states.get(vehicleId);
  }

  diagnostics(): MonitorDiagnostics {
    return {
      running: this.running,
      streamConnected: this.streamConnected,
      fallbackPolling: this.fallbackPollTimer !== undefined,
      consecutiveAuthFailures: this.authFailures,
    };
  }

  /** Start monitoring if stored credentials exist; no-op otherwise. */
  async startIfConfigured(): Promise<boolean> {
    const account = await this.tokenStore.load();
    if (!account || account.authState !== "ok") return false;
    await this.start(this.createConnection(account.tokens));
    return true;
  }

  /** Start with a freshly authenticated connection (from the connect flow). */
  async start(connection: RivianConnection): Promise<void> {
    await this.stop();
    const generation = ++this.generation;
    const superseded = () => generation !== this.generation;
    this.connection = connection;
    this.running = true;
    this.authFailures = 0;

    const info = await connection.api.getUserInfo();
    if (superseded()) return;
    this.vehicles = info.vehicles.map((uv) => ({
      id: uv.id,
      vin: uv.vin,
      name: uv.name ?? uv.vehicle?.model ?? uv.vin,
      make: uv.vehicle?.make ?? null,
      model: uv.vehicle?.model ?? null,
      modelYear: uv.vehicle?.modelYear ?? null,
    }));
    this.vinToId = new Map(this.vehicles.map((v) => [v.vin, v.id]));

    for (const uv of info.vehicles) {
      await this.db
        .insert(vehiclesTable)
        .values({
          id: uv.id,
          vin: uv.vin,
          name: uv.name,
          make: uv.vehicle?.make,
          model: uv.vehicle?.model,
          modelYear: uv.vehicle?.modelYear,
          supportedFeatures:
            uv.vehicle?.vehicleState?.supportedFeatures
              ?.filter((f) => f.status === "AVAILABLE")
              .map((f) => f.name) ?? [],
        })
        .onConflictDoUpdate({
          target: vehiclesTable.id,
          set: { name: uv.name, vin: uv.vin },
        });
    }

    await this.driveDetector.closeDanglingDrives();

    // Seed the cache with one poll per vehicle, then rely on the stream.
    for (const vehicle of this.vehicles) {
      try {
        const state = await connection.api.getVehicleState(vehicle.vin);
        this.states.set(vehicle.id, state ?? {});
      } catch (err) {
        this.log(`initial state poll failed for ${vehicle.vin}: ${(err as Error).message}`);
        this.states.set(vehicle.id, {});
      }
      if (superseded()) return;
    }

    const chargingMonitor = new ChargingMonitor(
      this.db,
      connection.api,
      this.bus,
      this.log,
    );
    this.chargingMonitor = chargingMonitor;
    chargingMonitor.onAuthFailure = () => void this.handleAuthFailure();
    chargingMonitor.onAuthOk = () => this.handleAuthOk();
    chargingMonitor.setVehicles(
      this.vehicles.map((v) => ({ id: v.id, vin: v.vin })),
    );

    const stream = connection.stream;
    stream.onAuthFailure = () => void this.handleAuthFailure();
    stream.onAuthenticated = () => this.handleAuthOk();
    stream.onConnectionChange = (connected) =>
      this.handleStreamConnection(connected);
    for (const vehicle of this.vehicles) {
      stream.subscribe(vehicle.vin, (vin, delta) => {
        void this.handleDelta(vin, delta);
      });
      stream.subscribeCharging?.(vehicle.vin, (_vin, session) => {
        void chargingMonitor.ingest(vehicle.id, session);
      });
    }

    await chargingMonitor.start();
    if (superseded()) return;
    // Plug state from the seed poll, so a session already in progress is tracked.
    for (const vehicle of this.vehicles) {
      const state = this.states.get(vehicle.id);
      if (state) chargingMonitor.setPluggedIn(vehicle.id, isPluggedIn(state));
    }
    stream.start();
    this.log(`monitoring ${this.vehicles.length} vehicle(s)`);
  }

  async stop(): Promise<void> {
    this.generation += 1;
    this.running = false;
    this.connection?.stream.stop();
    this.chargingMonitor?.stop();
    this.chargingMonitor = undefined;
    this.driveDetector.stop();
    this.clearFallbackTimers();
    this.streamConnected = false;
    this.connection = undefined;
  }

  private async handleDelta(vin: string, delta: VehicleState): Promise<void> {
    const vehicleId = this.vinToId.get(vin);
    if (!vehicleId) return;
    const cached = this.states.get(vehicleId) ?? {};
    const changed = mergeVehicleState(cached, delta);
    this.states.set(vehicleId, cached);
    if (changed.length === 0) return;

    this.bus.emitState(vehicleId, cached);

    const loc = stateLocation(cached);
    if (loc) this.chargingMonitor?.noteLocation(vehicleId, loc.latitude, loc.longitude);

    if (changed.includes("chargerStatus")) {
      this.chargingMonitor?.setPluggedIn(vehicleId, isPluggedIn(cached));
    }

    try {
      await this.driveDetector.onState(vehicleId, cached);
      await this.snapshotWriter.onState(vehicleId, cached);
    } catch (err) {
      this.log(`persistence error: ${(err as Error).message}`);
    }
  }

  private handleAuthOk(): void {
    this.authFailures = 0;
  }

  /**
   * Credentials were rejected (the HTTP client has already rotated the
   * session once for REST calls). Rotate for the socket too and keep going;
   * only repeated rejections mean the login itself is dead.
   */
  private async handleAuthFailure(): Promise<void> {
    if (!this.running) return;
    this.authFailures += 1;
    if (this.authFailures >= AUTH_FAILURE_THRESHOLD) {
      await this.handleUnauthenticated();
      return;
    }
    this.log(
      `Rivian rejected credentials (${this.authFailures}/${AUTH_FAILURE_THRESHOLD}); rotating session`,
    );
    try {
      await this.connection?.api.refreshSession();
    } catch (err) {
      this.log(`session rotation failed: ${(err as Error).message}`);
    }
  }

  private async handleUnauthenticated(): Promise<void> {
    this.log("Rivian session unauthenticated; stopping until re-login");
    await this.stop();
    await this.tokenStore.setAuthState("unauthenticated");
  }

  private handleStreamConnection(connected: boolean): void {
    this.streamConnected = connected;
    if (connected) {
      this.clearFallbackTimers();
      return;
    }
    if (!this.running || this.wsDownTimer) return;
    this.wsDownTimer = setTimeout(() => {
      this.log("websocket down >5min; falling back to slow polling");
      this.scheduleFallbackPoll();
    }, WS_DOWN_POLL_AFTER_MS);
  }

  /** Awake vehicles every 5 min, sleeping ones every 30 min. */
  private scheduleFallbackPoll(): void {
    if (!this.running || this.streamConnected) return;
    const asleep = this.vehicles.every((v) => {
      const power = stateString(this.states.get(v.id) ?? {}, "powerState");
      return power === null || ASLEEP_POWER_STATES.has(power);
    });
    this.fallbackPollTimer = setTimeout(async () => {
      await this.fallbackPoll();
      this.scheduleFallbackPoll();
    }, asleep ? FALLBACK_POLL_ASLEEP_MS : FALLBACK_POLL_AWAKE_MS);
  }

  private async fallbackPoll(): Promise<void> {
    const api = this.connection?.api;
    if (!api || !this.running) return;
    for (const vehicle of this.vehicles) {
      try {
        const state = await api.getVehicleState(vehicle.vin);
        this.handleAuthOk();
        if (state) await this.handleDelta(vehicle.vin, state);
      } catch (err) {
        if (err instanceof RivianUnauthenticatedError) {
          await this.handleAuthFailure();
          return;
        }
        this.log(`fallback poll failed: ${(err as Error).message}`);
      }
    }
  }

  private clearFallbackTimers(): void {
    if (this.wsDownTimer) clearTimeout(this.wsDownTimer);
    if (this.fallbackPollTimer) clearTimeout(this.fallbackPollTimer);
    this.wsDownTimer = undefined;
    this.fallbackPollTimer = undefined;
  }
}

function isPluggedIn(state: VehicleState): boolean {
  const status = stateString(state, "chargerStatus");
  return status !== null && status !== "chrgr_sts_not_connected";
}
