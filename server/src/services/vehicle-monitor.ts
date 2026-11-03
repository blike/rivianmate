import type { FeedLatestData, StreamDiagnostics } from '../rivian/subscription.js';
import type { Db } from '../db/client.js';
import { type Logger, silentLogger } from '../logger.js';
import { vehicles as vehiclesTable } from '../db/schema.js';
import type { RivianApi } from '../rivian/client.js';
import type { VehicleStateStream } from '../rivian/subscription.js';
import { CORE_VEHICLE_STATE_PROPERTIES } from '../rivian/graphql.js';
import {
  LEGACY_PREFERRED_FIELDS,
  PARALLAX_CORE_TOPICS,
  PARALLAX_STATE_FIELDS,
  activeProfile,
  chargingTimeWindow,
  chargingWindowSchedule,
  messageTime,
  tripInfo,
  vehicleSupportsParallax,
} from '../rivian/parallax/index.js';
import type { LookupSettings, SchedulesDto, VehicleInsightsDto } from '../api-types.js';
import {
  ChargingSchedule,
  DepartureSchedule,
  RivianTokens,
  RivianUnauthenticatedError,
  TimeStampedValue,
  VehicleState,
  isGraphqlValidationError,
} from '../rivian/types.js';
import { ChargeHistoryImporter } from './charge-history.js';
import { ChargingMonitor } from './charging-monitor.js';
import { DriveDetector } from './drive-detector.js';
import { Drivers } from './drivers.js';
import { HistoryKeys } from './history-keys.js';
import type { DrivePlaces } from './drive-places.js';
import type { DriveWeather } from './drive-weather.js';
import { LocationWriter } from './location-writer.js';
import { OtaNotesStore } from './ota-notes.js';
import { ParallaxArchive } from './parallax-archive.js';
import { ParallaxRouter } from './parallax-router.js';
import { ParallaxStore } from './parallax-store.js';
import { ChargingScheduleRefresh } from './schedule-refresh.js';
import type { LiveBus } from './live-bus.js';
import { StateHistoryRecorder } from './state-history.js';
import { mergeVehicleState, normalizeReadings, stateLocation, stateString } from './state-utils.js';
import type { TokenStore } from './token-store.js';

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
const ASLEEP_POWER_STATES = new Set(['sleep', 'standby']);
/** Charging schedules rarely change; a few checks a day is plenty. */
const SCHEDULE_REFRESH_MS = 6 * 3600_000;
/**
 * Rivian pushes departure schedules on subscribe only when there are some,
 * so a connected socket that stays silent this long means none are set.
 */
const DEPARTURES_SILENCE_MS = 30_000;
/** Which feed a vehicle state reading came from. */
type StateSource = 'legacy' | 'parallax';
/**
 * How often legacy reports a fix on a car that has legacy GPS of its own (an
 * R1: every few seconds). A slower feed isn't a track, so it doesn't outrank
 * the navigation one — a car reporting its own fix about once a minute (an R2)
 * is the car the navigation fixes exist for.
 */
const LEGACY_DENSE_MS = 30_000;
/** A dense feed that has gone this quiet is not outranking anything. */
const LEGACY_QUIET_MS = 5 * 60_000;
/**
 * Parallax sends the next charging window again as each one ends, so one
 * this old is from a schedule that's since been switched off.
 */
const PARALLAX_WINDOW_MAX_AGE_MS = 8 * 24 * 3600_000;
/** State fields that shape a charging session (plug, charging, SOC). */
const CHARGING_FIELDS = ['chargerStatus', 'chargerState', 'batteryLevel'];

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
  pollingStatus: 'stopped' | 'standby' | 'waiting' | 'fallback';
  subscriptions: StreamDiagnostics | null;
  consecutiveAuthFailures: number;
  /** Whether any monitored vehicle supports dynamics Parallax. */
  parallaxMode: 'classic' | 'parallax';
  parallaxModes: Record<string, 'classic' | 'parallax'>;
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
  private readonly log: Logger;
  private locationWriter: LocationWriter;
  private stateHistory: StateHistoryRecorder;
  private driveDetector: DriveDetector;
  private readonly drivers: Drivers;
  private chargingMonitor?: ChargingMonitor;
  private readonly otaNotes: OtaNotesStore;
  private readonly parallaxStore: ParallaxStore;
  private readonly parallaxArchive: ParallaxArchive;
  private chargeHistory?: ChargeHistoryImporter;
  private schedules = new Map<string, VehicleSchedules>();
  /** Each vehicle's legacy readings that outrank Parallax's, by field name. */
  private legacySeen = new Map<string, Set<string>>();
  /** Each vehicle's newest legacy fix, and the two gaps before it. */
  private legacyFix = new Map<
    string,
    { at: number; gapMs: number | null; previousGapMs: number | null }
  >();
  /** Whether each vehicle's track is currently coming from legacy's own fixes. */
  private legacyTracked = new Map<string, boolean>();
  private scheduleTimer?: NodeJS.Timeout;
  /** Re-queries schedules when Parallax's next charging window changes. */
  private readonly scheduleRefresh = new ChargingScheduleRefresh(async (vehicleId) => {
    const schedules = await this.fetchChargingSchedules(vehicleId);
    return Array.isArray(schedules) ? schedules : null;
  });
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
    /** Each service gets its own named child of this. */
    private readonly logger: Logger = silentLogger,
    /** Fills in drives' start and end places; absent when lookups are off. */
    private readonly drivePlaces?: DrivePlaces,
    /** Records the weather along drives; absent when lookups are off. */
    private readonly driveWeather?: DriveWeather,
  ) {
    this.log = logger.child({ component: 'monitor' });
    const keys = new HistoryKeys(db);
    this.locationWriter = new LocationWriter(db);
    this.stateHistory = new StateHistoryRecorder(db, keys);
    this.parallaxStore = new ParallaxStore(db, logger.child({ component: 'parallax' }));
    this.parallaxArchive = new ParallaxArchive(db, keys, logger.child({ component: 'parallax' }));
    this.otaNotes = new OtaNotesStore(db, logger.child({ component: 'ota' }));
    this.drivers = new Drivers(db, this.parallaxArchive, logger.child({ component: 'drivers' }));
    this.driveDetector = new DriveDetector(db, (vehicleId, driveId) => {
      this.locationWriter.setCurrentDrive(vehicleId, driveId);
      // Name the start and the driver while the drive is under way.
      if (driveId != null) {
        this.drivePlaces?.enqueue(driveId);
        this.drivers.enqueue(driveId);
      }
    });
    // Weather waits for the end, when the whole route is in; the driver is
    // looked at again for a profile picked just after the start.
    this.driveDetector.onDriveEnded = (driveId) => {
      this.drivePlaces?.enqueue(driveId);
      this.driveWeather?.enqueue(driveId);
      this.drivers.enqueue(driveId);
    };
    this.driveDetector.log = logger.child({ component: 'drive' });
  }

  /** Turns the address and weather lookups on or off, as set in Settings. */
  setLookups(lookups: LookupSettings): void {
    this.drivePlaces?.setEnabled(lookups.addresses);
    this.driveWeather?.setEnabled(lookups.weather);
  }

  /**
   * Drives and charges were added outside the monitor (an import): look up
   * their places. These don't involve Rivian, so it needn't be connected.
   */
  queueDriveLookups(): void {
    void this.drivePlaces
      ?.start()
      .catch((err: unknown) => this.log.warn({ err }, 'could not list drives for place lookups'));
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
      pollingStatus: !this.running
        ? 'stopped'
        : this.fallbackPollTimer !== undefined
          ? 'fallback'
          : this.streamConnected
            ? 'standby'
            : 'waiting',
      subscriptions: this.connection?.stream.diagnostics?.() ?? null,
      consecutiveAuthFailures: this.authFailures,
      parallaxMode: this.vehicles.some((v) => vehicleSupportsParallax(v.supportedFeatures))
        ? 'parallax'
        : 'classic',
      parallaxModes: Object.fromEntries(
        this.vehicles.map((v) => [
          v.id,
          vehicleSupportsParallax(v.supportedFeatures) ? 'parallax' : 'classic',
        ]),
      ),
    };
  }

  /**
   * What a feed last received since startup, and when its registry topics
   * that haven't come since were last archived; null for an unknown feed.
   */
  async feedLatestData(feedId: string): Promise<FeedLatestData | null> {
    const stream = this.connection?.stream;
    const latest = stream?.latestData?.(feedId) ?? null;
    const feed = stream?.diagnostics?.().feeds.find((f) => f.id === feedId);
    if (!latest || !feed || feed.domain == null) return latest;
    const received = new Set(latest.messages.map((m) => m.topic));
    const quiet = feed.topics
      .filter((t) => t.kind !== 'unregistered' && !received.has(t.rvm))
      .map((t) => t.rvm);
    if (quiet.length === 0) return latest;
    const archived = await this.parallaxArchive.lastArchivedAt(feed.vehicleId, quiet);
    return {
      ...latest,
      lastArchivedAt: Object.fromEntries(
        quiet.map((rvm) => [rvm, archived.get(rvm)?.toISOString() ?? null]),
      ),
    };
  }

  /** Start monitoring if usable stored credentials exist. */
  async startIfConfigured(): Promise<'started' | 'no_account' | 'needs_login'> {
    const account = await this.tokenStore.load();
    if (!account) return 'no_account';
    if (account.authState !== 'ok') return 'needs_login';
    try {
      await this.start(this.createConnection(account.tokens));
    } catch (err) {
      if (err instanceof RivianUnauthenticatedError) return 'needs_login';
      throw err;
    }
    return 'started';
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
          await this.tokenStore.setAuthState('unauthenticated');
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
        ?.filter((f) => f.status === 'AVAILABLE')
        .map((f) => f.name) ?? [];

    // Nice to have: on a failure the vehicle still runs, and keeps what was stored last.
    const [details, imageUrls] = await Promise.all([
      connection.api.getVehicleDetails().catch((err: unknown) => {
        this.log.warn({ err }, 'vehicle details fetch failed');
        return null;
      }),
      connection.api.getVehicleImageUrls().catch((err: unknown) => {
        this.log.warn({ err }, 'vehicle image fetch failed');
        return null;
      }),
    ]);
    if (superseded()) return;

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
          details: details?.[uv.id],
          images: imageUrls?.[uv.id],
        })
        .onConflictDoUpdate({
          target: vehiclesTable.id,
          set: {
            name: uv.name,
            vin: uv.vin,
            ...(details && { details: details[uv.id] ?? null }),
            ...(imageUrls && { images: imageUrls[uv.id] ?? null }),
          },
        });
    }

    await this.driveDetector.closeDanglingDrives(this.vehicles.map((v) => v.id));
    this.drivers.start();
    void this.drivePlaces
      ?.start()
      .catch((err: unknown) => this.log.error({ err }, 'drive place lookups failed to start'));
    void this.driveWeather
      ?.start()
      .catch((err: unknown) => this.log.error({ err }, 'temperature lookups failed to start'));

    // Seed the cache with one poll per vehicle, then rely on the stream.
    for (const vehicle of this.vehicles) {
      try {
        // Merged like the stream, so a field sent empty (every legacy field,
        // on an R2) isn't kept as if the vehicle had reported it.
        const state: VehicleState = {};
        mergeVehicleState(state, normalizeReadings((await this.pollState(vehicle.id)) ?? {}));
        this.states.set(vehicle.id, state);
        this.noteLegacyPreferred(vehicle.id, state);
      } catch (err) {
        this.log.warn({ err, vehicleId: vehicle.id }, 'initial state poll failed');
        this.states.set(vehicle.id, {});
      }
      if (superseded()) return;
    }

    this.otaNotes.connect(connection.api);
    for (const vehicle of this.vehicles) {
      void this.otaNotes.capture(vehicle.id, this.states.get(vehicle.id) ?? {});
    }

    const chargingMonitor = new ChargingMonitor(
      this.db,
      connection.api,
      this.bus,
      this.logger.child({ component: 'charging' }),
    );
    this.chargingMonitor = chargingMonitor;
    chargingMonitor.onAuthFailure = () => void this.handleAuthFailure();
    chargingMonitor.onAuthOk = () => this.handleAuthOk();
    const chargeHistory = new ChargeHistoryImporter(
      this.db,
      connection.api,
      () => this.vehicles.map((v) => v.id),
      this.logger.child({ component: 'charge-history' }),
    );
    chargeHistory.onAuthFailure = () => void this.handleAuthFailure();
    this.chargeHistory = chargeHistory;
    chargingMonitor.onSessionEnded = () => chargeHistory.scheduleAfterSession();
    chargingMonitor.setVehicles(this.vehicles.map((v) => v.id));

    const stream = connection.stream;
    stream.onAuthFailure = () => void this.handleAuthFailure();
    stream.onAuthenticated = () => this.handleAuthOk();
    stream.onConnectionChange = (connected) => this.handleStreamConnection(connected);
    // Each Parallax message is decoded once and handed to everything that
    // uses it; topics carrying legacy fields merge into vehicle state.
    const parallax = new ParallaxRouter(this.logger.child({ component: 'parallax' }))
      .on((vehicleId, decoded, message) =>
        chargingMonitor.ingestParallax(vehicleId, message, decoded),
      )
      .on((vehicleId, decoded, message) => this.parallaxStore.ingest(vehicleId, message, decoded))
      .on((vehicleId, _decoded, message) => this.parallaxArchive.ingest(vehicleId, message))
      .onTopic(chargingTimeWindow, (vehicleId, window) =>
        this.scheduleRefresh.noteWindow(vehicleId, window),
      )
      .onTopic(activeProfile, (vehicleId, profileId, message) =>
        this.drivers.noteProfile(
          vehicleId,
          profileId,
          messageTime(message.timestamp) ?? new Date(),
        ),
      )
      .onTopic(tripInfo, (vehicleId, trip) =>
        this.driveDetector.noteDestination(vehicleId, trip?.destination ?? null),
      )
      .onState((vehicleId, delta) => this.handleDelta(vehicleId, delta, 'parallax'));
    for (const vehicle of this.vehicles) {
      const parallaxActive = vehicleSupportsParallax(vehicle.supportedFeatures);
      // Rivian's vehicleState/chargingSession take the vehicle id from
      // getUserInfo, not the VIN (a VIN yields VEHICLE_NOT_FOUND).
      stream.subscribe(vehicle.id, (vehicleId, delta) => {
        void this.handleDelta(vehicleId, delta, 'legacy');
      });
      stream.subscribeCharging?.(vehicle.id, (_vehicleId, session) => {
        void chargingMonitor.ingest(vehicle.id, session);
      });
      // Every topic the vehicle sends; without the Parallax feature, only
      // the core ones, by name.
      stream.subscribeParallax?.(
        vehicle.id,
        parallaxActive ? null : PARALLAX_CORE_TOPICS,
        (_vehicleId, message) => parallax.dispatch(vehicle.id, message),
      );
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
    this.log.info(`monitoring ${this.vehicles.length} vehicle(s)`);
  }

  async stop(): Promise<void> {
    this.generation += 1;
    this.running = false;
    this.connection?.stream.stop();
    this.chargingMonitor?.stop();
    this.chargingMonitor = undefined;
    this.otaNotes.connect(undefined);
    this.chargeHistory?.stop();
    this.chargeHistory = undefined;
    if (this.scheduleTimer) clearInterval(this.scheduleTimer);
    this.scheduleTimer = undefined;
    this.scheduleRefresh.stop();
    this.driveDetector.stop();
    this.drivers.stop();
    this.drivePlaces?.stop();
    this.driveWeather?.stop();
    this.clearFallbackTimers();
    this.streamConnected = false;
    this.streamConnectedAt = null;
    this.connection = undefined;
  }

  /**
   * Readings to merge, with LEGACY_PREFERRED_FIELDS settled: legacy's
   * reading replaces Parallax's even when it's older, and Parallax's is
   * used only while legacy hasn't reported the field (an R2).
   *
   * `navLocation` is settled against legacy's `gnssLocation` too, but only
   * where legacy is a dense feed of its own: an R1 reports a fix every few
   * seconds, so a navigation fix adds nothing there, while a car whose own
   * fix comes once a minute is exactly the car this stream is for — one
   * stale legacy reading must not cost it the track. A dense feed that goes
   * quiet stops outranking the navigation fix, so the rule follows the feed
   * rather than latching on its first reading.
   */
  private preferLegacy(
    vehicleId: string,
    readings: VehicleState,
    source: StateSource,
    cached: VehicleState,
  ): VehicleState {
    if (source === 'legacy') {
      this.noteLegacyPreferred(vehicleId, readings);
      for (const f of LEGACY_PREFERRED_FIELDS) {
        const incoming = readings[f] as TimeStampedValue | undefined;
        const held = cached[f] as TimeStampedValue | undefined;
        // Newest-wins merging would keep a newer Parallax reading over it.
        if (incoming && held && Date.parse(held.timeStamp) > Date.parse(incoming.timeStamp)) {
          delete cached[f];
        }
      }
      return readings;
    }
    const seen = this.legacySeen.get(vehicleId);
    const nav = readings.navLocation ?? cached.navLocation;
    const navAt = nav ? Date.parse(nav.timeStamp) : Number.NaN;
    const legacyHasTrack = Number.isFinite(navAt) && this.legacyTracks(vehicleId, navAt);
    // Only when a fix is in play: with none cached there is nothing to choose.
    if (nav) this.noteTrackChange(vehicleId, legacyHasTrack);
    // Legacy is a track of its own: drop the navigation fix, and the one held
    // from before, so the writer stops preferring it to legacy's own fixes.
    if (legacyHasTrack) delete cached.navLocation;
    if (!seen && !legacyHasTrack) return readings;
    return Object.fromEntries(
      Object.entries(readings).filter(([key]) =>
        key === 'navLocation' ? !legacyHasTrack : !seen?.has(key),
      ),
    );
  }

  /** Says once, as it changes, which of the two fixes a vehicle's track is coming from. */
  private noteTrackChange(vehicleId: string, legacyHasTrack: boolean): void {
    if (this.legacyTracked.get(vehicleId) === legacyHasTrack) return;
    this.legacyTracked.set(vehicleId, legacyHasTrack);
    this.log.info(
      {
        vehicleId,
        legacyFixGapMs: this.legacyFix.get(vehicleId)?.gapMs ?? null,
        legacyFixPreviousGapMs: this.legacyFix.get(vehicleId)?.previousGapMs ?? null,
      },
      legacyHasTrack
        ? 'legacy reports a dense fix stream; using it for the track'
        : 'using navigation fixes for the track',
    );
  }

  private noteLegacyPreferred(vehicleId: string, readings: VehicleState): void {
    this.noteLegacyFix(vehicleId, readings);
    for (const f of LEGACY_PREFERRED_FIELDS) {
      if (readings[f] == null) continue;
      let seen = this.legacySeen.get(vehicleId);
      if (!seen) this.legacySeen.set(vehicleId, (seen = new Set()));
      seen.add(f);
    }
  }

  /**
   * How often legacy is reporting its own fix. A fix Rivian reads as 0,0 is
   * no fix, and a re-sent one keeps the cadence it had. Two gaps are kept: one
   * short gap is a wake-up burst, not a feed.
   */
  private noteLegacyFix(vehicleId: string, readings: VehicleState): void {
    const loc = stateLocation(readings);
    const at = loc ? Date.parse(loc.timeStamp) : Number.NaN;
    if (!Number.isFinite(at)) return;
    const last = this.legacyFix.get(vehicleId);
    if (last && at <= last.at) return;
    this.legacyFix.set(vehicleId, {
      at,
      gapMs: last ? at - last.at : null,
      previousGapMs: last?.gapMs ?? null,
    });
  }

  /** Whether legacy is a track of its own as of `at`: dense, and still current. */
  private legacyTracks(vehicleId: string, at: number): boolean {
    const fix = this.legacyFix.get(vehicleId);
    if (!fix || fix.gapMs == null || fix.previousGapMs == null) return false;
    const dense = fix.gapMs <= LEGACY_DENSE_MS && fix.previousGapMs <= LEGACY_DENSE_MS;
    return dense && at - fix.at <= LEGACY_QUIET_MS;
  }

  private async handleDelta(
    vehicleId: string,
    delta: VehicleState,
    source: StateSource,
  ): Promise<void> {
    if (!this.vehicles.some((v) => v.id === vehicleId)) return;
    const readings = normalizeReadings(delta);
    const cached = this.states.get(vehicleId) ?? {};
    const changed = mergeVehicleState(
      cached,
      this.preferLegacy(vehicleId, readings, source, cached),
      PARALLAX_STATE_FIELDS,
    );
    this.states.set(vehicleId, cached);
    if (changed.length === 0) return;

    // Nothing reads a navigation fix live (the map, geofence, charging and
    // drive detection read `gnssLocation`): the track's writer is its only
    // consumer.
    if (changed.length === 1 && changed[0] === 'navLocation') {
      await this.locationWriter.onState(vehicleId, { ...cached }).catch((err: unknown) => {
        this.log.error({ err, vehicleId }, 'saving vehicle state failed');
      });
      return;
    }

    this.bus.emitState(vehicleId, cached);

    const loc = stateLocation(cached);
    if (loc) this.chargingMonitor?.noteLocation(vehicleId, loc.latitude, loc.longitude);

    if (changed.includes('otaCurrentVersion') || changed.includes('otaAvailableVersion')) {
      void this.otaNotes.capture(vehicleId, cached);
    }

    if (changed.includes('activeDriverName')) {
      this.drivers.noteName(vehicleId, stateString(cached, 'activeDriverName'));
    }

    if (CHARGING_FIELDS.some((f) => changed.includes(f))) {
      this.chargingMonitor?.noteState(vehicleId, cached);
    }

    // As of this delta: later ones change the cache while these run.
    const state = { ...cached };
    const history = this.stateHistory
      .record(vehicleId, state, changed)
      .catch((err: unknown) => this.log.error({ err, vehicleId }, 'saving state history failed'));
    try {
      await this.driveDetector.onState(vehicleId, state);
      await this.locationWriter.onState(vehicleId, state);
    } catch (err) {
      this.log.error({ err, vehicleId }, 'saving vehicle state failed');
    }
    await history;
  }

  /** Latest Parallax readings (battery temperatures, parked energy, …). */
  getInsights(vehicleId: string): Promise<VehicleInsightsDto> {
    return this.parallaxStore.insights(vehicleId);
  }

  /** The stored release notes for a version, saving them first if Rivian has them. */
  async getReleaseNotes(vehicleId: string, version: string): Promise<Buffer | null> {
    const stored = await this.otaNotes.pdf(vehicleId, version);
    if (stored) return stored;
    await this.otaNotes.capture(vehicleId, this.states.get(vehicleId) ?? {});
    return this.otaNotes.pdf(vehicleId, version);
  }

  /** Versions whose release notes are stored. */
  releaseNotesVersions(vehicleId: string): Promise<Set<string>> {
    return this.otaNotes.storedVersions(vehicleId);
  }

  async getSchedules(vehicleId: string): Promise<SchedulesDto> {
    const entry = this.schedules.get(vehicleId);
    // Without legacy's schedules (an R2), Parallax's next window stands in.
    const window = entry?.charging?.length
      ? null
      : await this.parallaxStore.latest(vehicleId, chargingTimeWindow);
    const fresh = window && Date.now() - window.at.getTime() < PARALLAX_WINDOW_MAX_AGE_MS;
    const fromParallax = fresh ? chargingWindowSchedule(window.value) : null;
    const unavailable =
      this.connection?.stream.isUnsupported?.('departureSchedules', vehicleId) ?? false;
    const silentLongEnough =
      this.streamConnectedAt !== null &&
      Date.now() - this.streamConnectedAt >= DEPARTURES_SILENCE_MS;
    return {
      charging: fromParallax ? [fromParallax] : (entry?.charging ?? null),
      chargingFromParallax: fromParallax != null,
      departures: entry?.departures ?? (!unavailable && silentLongEnough ? [] : null),
      departuresUnavailable: unavailable,
      chargingUpdatedAt: fromParallax
        ? window!.at.toISOString()
        : (entry?.chargingAt?.toISOString() ?? null),
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
    for (const vehicle of this.vehicles) {
      if ((await this.fetchChargingSchedules(vehicle.id)) === 'stop') return;
    }
  }

  /**
   * One vehicle's charging schedules from Rivian, kept for getSchedules;
   * 'failed' when they couldn't be fetched, 'stop' when no vehicle's can be.
   */
  private async fetchChargingSchedules(
    vehicleId: string,
  ): Promise<ChargingSchedule[] | 'failed' | 'stop'> {
    const api = this.connection?.api;
    if (!api || !this.running || this.chargingScheduleUnsupported) return 'stop';
    try {
      const schedules = await api.getChargingSchedules(vehicleId);
      const entry = this.scheduleEntry(vehicleId);
      entry.charging = schedules;
      entry.chargingAt = new Date();
      return schedules;
    } catch (err) {
      if (isGraphqlValidationError(err)) {
        this.chargingScheduleUnsupported = true;
        this.log.warn({ err }, 'charging schedule query not supported; disabling');
        return 'stop';
      }
      if (err instanceof RivianUnauthenticatedError) {
        await this.handleAuthFailure();
        return 'stop';
      }
      this.log.warn({ err, vehicleId }, 'charging schedule fetch failed');
      return 'failed';
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
    this.log.warn(
      `Rivian rejected credentials (${this.authFailures}/${AUTH_FAILURE_THRESHOLD}); rotating session`,
    );
    try {
      await this.connection?.api.refreshSession();
    } catch (err) {
      this.log.error({ err }, 'session rotation failed');
    }
  }

  private async handleUnauthenticated(): Promise<void> {
    this.log.error('Rivian session unauthenticated; stopping until you sign in again');
    await this.stop();
    await this.tokenStore.setAuthState('unauthenticated');
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
      this.log.warn('live stream down for 5 minutes; falling back to slow polling');
      this.scheduleFallbackPoll();
    }, WS_DOWN_POLL_AFTER_MS);
  }

  /** Awake vehicles every 5 min, sleeping ones every 30 min. */
  private scheduleFallbackPoll(): void {
    if (!this.running || this.streamConnected) return;
    const asleep = this.vehicles.every((v) => {
      const power = stateString(this.states.get(v.id) ?? {}, 'powerState');
      return power === null || ASLEEP_POWER_STATES.has(power);
    });
    this.fallbackPollTimer = setTimeout(
      async () => {
        await this.fallbackPoll();
        this.scheduleFallbackPoll();
      },
      asleep ? FALLBACK_POLL_ASLEEP_MS : FALLBACK_POLL_AWAKE_MS,
    );
  }

  private async fallbackPoll(): Promise<void> {
    const api = this.connection?.api;
    if (!api || !this.running) return;
    for (const vehicle of this.vehicles) {
      try {
        const state = await this.pollState(vehicle.id);
        this.handleAuthOk();
        if (state) await this.handleDelta(vehicle.id, state, 'legacy');
      } catch (err) {
        if (err instanceof RivianUnauthenticatedError) {
          await this.handleAuthFailure();
          return;
        }
        this.log.warn({ err }, 'fallback poll failed');
      }
    }
  }

  /**
   * Polls vehicle state. If Rivian rejects the full selection as invalid,
   * logs the details once and switches to the core field set.
   */
  private async pollState(vehicleId: string): Promise<VehicleState> {
    const api = this.connection?.api;
    if (!api) throw new Error('not connected');
    if (this.coreStateQuery) {
      return api.getVehicleState(vehicleId, CORE_VEHICLE_STATE_PROPERTIES);
    }
    try {
      return await api.getVehicleState(vehicleId);
    } catch (err) {
      if (!isGraphqlValidationError(err)) throw err;
      this.log.warn({ err }, 'Rivian rejected the full state query; using core fields');
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
