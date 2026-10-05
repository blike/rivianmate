import type { StreamDiagnostics } from "../rivian/subscription.js";
import type { Db } from "../db/client.js";
import { vehicles as vehiclesTable } from "../db/schema.js";
import type { RivianApi } from "../rivian/client.js";
import type { VehicleStateStream } from "../rivian/subscription.js";
import { CORE_VEHICLE_STATE_PROPERTIES } from "../rivian/graphql.js";
import {
  PARALLAX_DYNAMICS_FIELDS,
  PARALLAX_DYNAMICS_RVMS,
  PARALLAX_MONITOR_RVMS,
  RVM_GNSS,
  RVM_TIRES,
  RVM_TRIP_INFO,
  decodeGnss,
  decodeTires,
  decodeTripInfo,
  vehicleSupportsParallax,
} from "../rivian/parallax.js";
import type { SchedulesDto, VehicleInsightsDto } from "../api-types.js";
import {
  ChargingSchedule,
  DepartureSchedule,
  RivianTokens,
  RivianUnauthenticatedError,
  VehicleState,
  describeRivianError,
  isGraphqlValidationError,
} from "../rivian/types.js";
import { ChargeHistoryImporter } from "./charge-history.js";
import { ChargingMonitor } from "./charging-monitor.js";
import { DriveDetector } from "./drive-detector.js";
import type { DrivePlaces } from "./drive-places.js";
import { OtaNotesTracker } from "./ota-notes.js";
import { ParallaxStore, messageTime } from "./parallax-store.js";
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
/** Charging schedules rarely change; a few checks a day is plenty. */
const SCHEDULE_REFRESH_MS = 6 * 3600_000;
/**
 * Rivian pushes departure schedules on subscribe only when there are some,
 * so a connected socket that stays silent this long means none are set.
 */
const DEPARTURES_SILENCE_MS = 30_000;
/** State fields that shape a charging session (plug, charging, SOC). */
const CHARGING_FIELDS = ["chargerStatus", "chargerState", "batteryLevel"];

interface VehicleSchedules {
  charging: ChargingSchedule[] | null;
  chargingAt: Date | null;
  departures: DepartureSchedule[] | null;
  departuresAt: Date | null;
}

export interface MonitorDiagnostics {
  running: boolean;
  streamConnected: boolean;
  fallbackPolling: boolean;
  pollingStatus: "stopped" | "standby" | "waiting" | "fallback";
  subscriptions: StreamDiagnostics | null;
  consecutiveAuthFailures: number;
  /** Whether any monitored vehicle supports dynamics Parallax. */
  parallaxMode: "classic" | "parallax";
  parallaxModes: Record<string, "classic" | "parallax">;
  /** Legacy fields Rivian has rejected from the subscription (e.g. gnssLocation). */
  parallaxDroppedFields: readonly string[];
}

export interface MonitoredVehicle {
  id: string;
  vin: string;
  name: string | null;
  make: string | null;
  model: string | null;
  modelYear: number | null;
  supportedFeatures: readonly string[];
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
  private snapshotWriter: SnapshotWriter;
  private driveDetector: DriveDetector;
  private chargingMonitor?: ChargingMonitor;
  private otaNotes?: OtaNotesTracker;
  private readonly parallaxStore: ParallaxStore;
  private chargeHistory?: ChargeHistoryImporter;
  private schedules = new Map<string, VehicleSchedules>();
  private scheduleTimer?: NodeJS.Timeout;
  private chargingScheduleUnsupported = false;
  private wsDownTimer?: NodeJS.Timeout;
  private fallbackPollTimer?: NodeJS.Timeout;
  private running = false;
  private streamConnected = false;
  private streamConnectedAt: number | null = null;
  private authFailures = 0;
  /** Set once Rivian rejects the full state query; sticky for the process. */
  private coreStateQuery = false;
  /** Bumped on every start/stop so a superseded start() bails out. */
  private generation = 0;

  constructor(
    private readonly db: Db,
    private readonly tokenStore: TokenStore,
    private readonly bus: LiveBus,
    private readonly createConnection: (tokens: RivianTokens) => RivianConnection,
    private readonly log: (msg: string) => void = console.log,
    /** Fills in drives' start and end places; absent when lookups are off. */
    private readonly drivePlaces?: DrivePlaces,
  ) {
    this.snapshotWriter = new SnapshotWriter(db);
    this.parallaxStore = new ParallaxStore(db, log);
    this.driveDetector = new DriveDetector(db, (vehicleId, driveId) => {
      this.snapshotWriter.setCurrentDrive(vehicleId, driveId);
      // Name the start while the drive is under way.
      if (driveId != null) this.drivePlaces?.enqueue(driveId);
    });
    this.driveDetector.onDriveEnded = (driveId) => this.drivePlaces?.enqueue(driveId);
    this.driveDetector.log = log;
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
      pollingStatus: !this.running ? "stopped" : this.fallbackPollTimer !== undefined ? "fallback"
        : this.streamConnected ? "standby" : "waiting",
      subscriptions: this.connection?.stream.diagnostics?.() ?? null,
      consecutiveAuthFailures: this.authFailures,
      parallaxMode: this.vehicles.some((v) => vehicleSupportsParallax(v.supportedFeatures)) ? "parallax" : "classic",
      parallaxModes: Object.fromEntries(this.vehicles.map((v) => [
        v.id, vehicleSupportsParallax(v.supportedFeatures) ? "parallax" : "classic",
      ])),
      parallaxDroppedFields: this.connection?.stream.droppedFields ?? [],
    };
  }

  /** Start monitoring if usable stored credentials exist. */
  async startIfConfigured(): Promise<"started" | "no_account" | "needs_login"> {
    const account = await this.tokenStore.load();
    if (!account) return "no_account";
    if (account.authState !== "ok") return "needs_login";
    try {
      await this.start(this.createConnection(account.tokens));
    } catch (err) {
      if (err instanceof RivianUnauthenticatedError) return "needs_login";
      throw err;
    }
    return "started";
  }

  /** Start with a freshly authenticated connection (from the connect flow). */
  async start(connection: RivianConnection): Promise<void> {
    await this.stop();
    const generation = ++this.generation;
    this.connection = connection;
    this.running = true;
    this.authFailures = 0;

    try {
      await this.initialize(connection, generation);
    } catch (err) {
      // A failed older start must not stop a newer connection.
      if (generation === this.generation) {
        await this.stop();
        if (err instanceof RivianUnauthenticatedError) {
          await this.tokenStore.setAuthState("unauthenticated");
        }
      }
      throw err;
    }
  }

  private async initialize(connection: RivianConnection, generation: number): Promise<void> {
    const superseded = () => generation !== this.generation;
    const info = await connection.api.getUserInfo();
    if (superseded()) return;
    const supportedFeaturesOf = (uv: (typeof info.vehicles)[number]): string[] =>
      uv.vehicle?.vehicleState?.supportedFeatures
        ?.filter((f) => f.status === "AVAILABLE")
        .map((f) => f.name) ?? [];

    this.vehicles = info.vehicles.map((uv) => ({
      id: uv.id,
      vin: uv.vin,
      name: uv.name ?? uv.vehicle?.model ?? uv.vin,
      make: uv.vehicle?.make ?? null,
      model: uv.vehicle?.model ?? null,
      modelYear: uv.vehicle?.modelYear ?? null,
      supportedFeatures: supportedFeaturesOf(uv),
    }));

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
          supportedFeatures: supportedFeaturesOf(uv),
        })
        .onConflictDoUpdate({
          target: vehiclesTable.id,
          set: { name: uv.name, vin: uv.vin },
        });
    }

    await this.driveDetector.closeDanglingDrives(this.vehicles.map((v) => v.id));
    void this.drivePlaces?.start().catch((err: Error) => this.log(`drive places: ${err.message}`));

    // Seed the cache with one poll per vehicle, then rely on the stream.
    for (const vehicle of this.vehicles) {
      try {
        const state = await this.pollState(vehicle.id);
        this.states.set(vehicle.id, state ?? {});
      } catch (err) {
        this.log(`initial state poll failed for ${vehicle.vin}: ${describeRivianError(err)}`);
        this.states.set(vehicle.id, {});
      }
      if (superseded()) return;
    }

    const otaNotes = new OtaNotesTracker(this.db, connection.api, this.log);
    this.otaNotes = otaNotes;
    for (const vehicle of this.vehicles) {
      const state = this.states.get(vehicle.id);
      if (state) await otaNotes.check(vehicle.id, state);
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
    const chargeHistory = new ChargeHistoryImporter(
      this.db,
      connection.api,
      () => this.vehicles.map((v) => v.id),
      this.log,
    );
    chargeHistory.onAuthFailure = () => void this.handleAuthFailure();
    this.chargeHistory = chargeHistory;
    chargingMonitor.onSessionEnded = () => chargeHistory.scheduleAfterSession();
    chargingMonitor.setVehicles(
      this.vehicles.map((v) => v.id),
    );

    const stream = connection.stream;
    stream.onAuthFailure = () => void this.handleAuthFailure();
    stream.onAuthenticated = () => this.handleAuthOk();
    stream.onConnectionChange = (connected) =>
      this.handleStreamConnection(connected);
    for (const vehicle of this.vehicles) {
      const parallaxActive = vehicleSupportsParallax(vehicle.supportedFeatures);
      // Rivian's vehicleState/chargingSession take the vehicle id from
      // getUserInfo, not the VIN (a VIN yields VEHICLE_NOT_FOUND).
      stream.subscribe(vehicle.id, (vehicleId, delta) => {
        void this.handleDelta(vehicleId, delta);
      });
      stream.subscribeCharging?.(vehicle.id, (_vehicleId, session) => {
        void chargingMonitor.ingest(vehicle.id, session);
      });
      // Unconditional, as upstream originally had it — unaffected by
      // whether this vehicle also gets the dynamics subscription below.
      stream.subscribeParallax?.(vehicle.id, PARALLAX_MONITOR_RVMS, (_vehicleId, message) => {
        void chargingMonitor.ingestParallax(vehicle.id, message);
        void this.parallaxStore.ingest(vehicle.id, message);
        if (message.rvm === RVM_TRIP_INFO) {
          const destination = decodeTripInfo(message.payload)?.destination ?? null;
          void this.driveDetector.noteDestination(vehicle.id, destination).catch((err: Error) =>
            this.log(`drive destination: ${err.message}`),
          );
        }
      });
      if (parallaxActive) {
        // Its own subscription (own id, own rejection fate): a vehicle that
        // rejects dynamics.vehicle.gnss (e.g. an R1) can't take down the
        // battery/charging/trip Parallax subscription above.
        stream.subscribeParallaxDynamics?.(vehicle.id, PARALLAX_DYNAMICS_RVMS, (_vehicleId, message) => {
          const ts = (messageTime(message.timestamp) ?? new Date()).toISOString();
          if (message.rvm === RVM_GNSS) {
            const reading = decodeGnss(message.payload);
            if (reading) {
              const delta: VehicleState = {};
              if (reading.latitude != null && reading.longitude != null) {
                delta.gnssLocation = { latitude: reading.latitude, longitude: reading.longitude, timeStamp: ts };
              }
              if (reading.altitude != null) delta.gnssAltitude = { timeStamp: ts, value: reading.altitude };
              if (reading.bearing != null) delta.gnssBearing = { timeStamp: ts, value: reading.bearing };
              if (reading.speedMps != null) delta.gnssSpeed = { timeStamp: ts, value: reading.speedMps };
              if (Object.keys(delta).length > 0) void this.handleDelta(vehicle.id, delta);
            }
          } else if (message.rvm === RVM_TIRES) {
            const delta: VehicleState = {};
            for (const tire of decodeTires(message.payload)) {
              if (tire.pressureBar != null) {
                delta[`tirePressure${tire.position}`] = { timeStamp: ts, value: tire.pressureBar };
              }
              if (tire.status != null) {
                delta[`tirePressureStatus${tire.position}`] = { timeStamp: ts, value: tire.status };
              }
            }
            if (Object.keys(delta).length > 0) void this.handleDelta(vehicle.id, delta);
          }
        });
      }
      stream.subscribeDepartureSchedules?.(vehicle.id, (_vehicleId, departures) => {
        const entry = this.scheduleEntry(vehicle.id);
        entry.departures = departures;
        entry.departuresAt = new Date();
      });
    }

    await chargingMonitor.start();
    if (superseded()) return;
    // Plug state from the seed poll, so a plug-in already under way is
    // tracked. An unknown plug state (seed poll failed) is ignored, so it
    // can't close a session left open by a restart.
    for (const vehicle of this.vehicles) {
      const state = this.states.get(vehicle.id);
      if (state) chargingMonitor.noteState(vehicle.id, state);
    }
    stream.start();
    await this.refreshChargingSchedules();
    chargeHistory.start();
    this.scheduleTimer = setInterval(
      () => void this.refreshChargingSchedules(),
      SCHEDULE_REFRESH_MS,
    );
    this.log(`monitoring ${this.vehicles.length} vehicle(s)`);
  }

  async stop(): Promise<void> {
    this.generation += 1;
    this.running = false;
    this.connection?.stream.stop();
    this.chargingMonitor?.stop();
    this.chargingMonitor = undefined;
    this.otaNotes = undefined;
    this.chargeHistory?.stop();
    this.chargeHistory = undefined;
    if (this.scheduleTimer) clearInterval(this.scheduleTimer);
    this.scheduleTimer = undefined;
    this.driveDetector.stop();
    this.drivePlaces?.stop();
    this.clearFallbackTimers();
    this.streamConnected = false;
    this.streamConnectedAt = null;
    this.connection = undefined;
  }

  private async handleDelta(vehicleId: string, delta: VehicleState): Promise<void> {
    if (!this.vehicles.some((v) => v.id === vehicleId)) return;
    const cached = this.states.get(vehicleId) ?? {};
    const changed = mergeVehicleState(cached, delta, PARALLAX_DYNAMICS_FIELDS);
    this.states.set(vehicleId, cached);
    if (changed.length === 0) return;

    this.bus.emitState(vehicleId, cached);

    const loc = stateLocation(cached);
    if (loc) this.chargingMonitor?.noteLocation(vehicleId, loc.latitude, loc.longitude);

    if (changed.includes("otaCurrentVersion") || changed.includes("otaAvailableVersion")) {
      void this.otaNotes?.check(vehicleId, cached);
    }

    if (CHARGING_FIELDS.some((f) => changed.includes(f))) {
      this.chargingMonitor?.noteState(vehicleId, cached);
    }

    try {
      await this.driveDetector.onState(vehicleId, cached);
      await this.snapshotWriter.onState(vehicleId, cached);
    } catch (err) {
      this.log(`persistence error: ${(err as Error).message}`);
    }
  }

  /** Latest Parallax readings (battery temperatures, parked energy, …). */
  getInsights(vehicleId: string): Promise<VehicleInsightsDto> {
    return this.parallaxStore.insights(vehicleId);
  }

  getSchedules(vehicleId: string): SchedulesDto {
    const entry = this.schedules.get(vehicleId);
    const unavailable = this.connection?.stream.isUnsupported?.("departureSchedules") ?? false;
    const silentLongEnough =
      this.streamConnectedAt !== null && Date.now() - this.streamConnectedAt >= DEPARTURES_SILENCE_MS;
    return {
      charging: entry?.charging ?? null,
      departures: entry?.departures ?? (!unavailable && silentLongEnough ? [] : null),
      departuresUnavailable: unavailable,
      chargingUpdatedAt: entry?.chargingAt?.toISOString() ?? null,
      departuresUpdatedAt: entry?.departuresAt?.toISOString() ?? null,
    };
  }

  private scheduleEntry(vehicleId: string): VehicleSchedules {
    let entry = this.schedules.get(vehicleId);
    if (!entry) {
      entry = { charging: null, chargingAt: null, departures: null, departuresAt: null };
      this.schedules.set(vehicleId, entry);
    }
    return entry;
  }

  private async refreshChargingSchedules(): Promise<void> {
    const api = this.connection?.api;
    if (!api || !this.running || this.chargingScheduleUnsupported) return;
    for (const vehicle of this.vehicles) {
      try {
        const schedules = await api.getChargingSchedules(vehicle.id);
        const entry = this.scheduleEntry(vehicle.id);
        entry.charging = schedules;
        entry.chargingAt = new Date();
      } catch (err) {
        if (isGraphqlValidationError(err)) {
          this.chargingScheduleUnsupported = true;
          this.log(`charging schedule query not supported: ${describeRivianError(err)}`);
          return;
        }
        if (err instanceof RivianUnauthenticatedError) {
          await this.handleAuthFailure();
          return;
        }
        this.log(`charging schedule fetch failed: ${describeRivianError(err)}`);
      }
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
    this.streamConnectedAt = connected ? (this.streamConnectedAt ?? Date.now()) : null;
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
        const state = await this.pollState(vehicle.id);
        this.handleAuthOk();
        if (state) await this.handleDelta(vehicle.id, state);
      } catch (err) {
        if (err instanceof RivianUnauthenticatedError) {
          await this.handleAuthFailure();
          return;
        }
        this.log(`fallback poll failed: ${describeRivianError(err)}`);
      }
    }
  }

  /**
   * Polls vehicle state. If Rivian rejects the full selection as invalid,
   * logs the details once and switches to the core field set.
   */
  private async pollState(vehicleId: string): Promise<VehicleState> {
    const api = this.connection?.api;
    if (!api) throw new Error("not connected");
    if (this.coreStateQuery) {
      return api.getVehicleState(vehicleId, CORE_VEHICLE_STATE_PROPERTIES);
    }
    try {
      return await api.getVehicleState(vehicleId);
    } catch (err) {
      if (!isGraphqlValidationError(err)) throw err;
      this.log(
        `Rivian rejected the full state query (${describeRivianError(err)}); using core fields`,
      );
      this.coreStateQuery = true;
      return api.getVehicleState(vehicleId, CORE_VEHICLE_STATE_PROPERTIES);
    }
  }

  private clearFallbackTimers(): void {
    if (this.wsDownTimer) clearTimeout(this.wsDownTimer);
    if (this.fallbackPollTimer) clearTimeout(this.fallbackPollTimer);
    this.wsDownTimer = undefined;
    this.fallbackPollTimer = undefined;
  }
}

