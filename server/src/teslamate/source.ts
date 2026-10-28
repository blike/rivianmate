import postgres from 'postgres';
import type {
  BatteryHealthDto,
  BatteryWindowDto,
  ChargeSpanDto,
  ChargingCurvePointDto,
  ChargingSessionDto,
  DriveCoverageDto,
  DriveDetailDto,
  DriveDto,
  HistoryPoint,
  LocationPointDto,
  OtaTimelineDto,
  PhantomDrainDto,
  SchedulesDto,
  StateSpanDto,
  TirePressurePointDto,
  VehicleDto,
  VehicleInsightsDto,
} from '../api-types.js';
import { type Logger, silentLogger } from '../logger.js';
import type { VehicleState } from '../rivian/types.js';
import { type DrainSnapshot, parkedLoss, phantomDrain } from '../services/health.js';
import type { LiveBus } from '../services/live-bus.js';
import { thinTrack, trackToleranceM } from '../services/simplify-track.js';
import { stateNumber } from '../services/state-utils.js';
import { teslamateCarId } from './ids.js';
import {
  type CarRow,
  type CarSnapshot,
  type DriveProgress,
  type GeofenceRow,
  type RangeKind,
  activitySpans,
  buildVehicleState,
  type Places,
  capacityHistory,
  liveChargingSession,
  softwareVersion,
  toDriveDto,
  toSessionDto,
  toVehicleDto,
} from './mapping.js';
import * as q from './queries.js';
import type { ListWindow } from './queries.js';

/** Polls TeslaMate this often while a car is driving or charging… */
const ACTIVE_POLL_MS = 5_000;
/** …while one is awake… */
const ONLINE_POLL_MS = 20_000;
/** …and otherwise. */
const IDLE_POLL_MS = 60_000;
/** After a failed read, back off up to this. */
const MAX_RETRY_MS = 5 * 60_000;
/** The car list is reread this often, to pick up cars added to TeslaMate. */
const CARS_REFRESH_MS = 10 * 60_000;
/**
 * An open drive or charge with nothing logged for this long is left over
 * from TeslaMate stopping mid-way, not under way now.
 */
const ACTIVE_STALE_MS = 30 * 60_000;

/**
 * TeslaMate logs a position every few seconds; a long window is thinned
 * evenly to about this many before its drives are simplified.
 */
const MAX_LOCATION_ROWS = 200_000;
const MAX_DRIVE_POINTS = 10_000;
/** Energy used while parked over the last day and week. */
const PARKED_WINDOW_MINUTES = [24 * 60, 7 * 24 * 60];

const BUCKET_INTERVALS: Record<string, string> = {
  '5m': '5 minutes',
  '15m': '15 minutes',
  '1h': '1 hour',
  '6h': '6 hours',
  '1d': '1 day',
};

export const EMPTY_INSIGHTS: VehicleInsightsDto = {
  cellTemps: null,
  cellTempsCurrent: false,
  coldWeather: null,
  parkedEnergy: null,
  navigation: null,
  connectivity: null,
};

export const NO_SCHEDULES: SchedulesDto = {
  charging: null,
  chargingFromParallax: false,
  departures: null,
  departuresUnavailable: true,
  chargingUpdatedAt: null,
  departuresUpdatedAt: null,
};

/**
 * Opens a connection that can only read: the session defaults every
 * transaction to read-only, so even a mistaken write would be refused by
 * Postgres. `extra` sets more session parameters (tests use search_path).
 */
export function connectReadOnly(url: string, extra: Record<string, string> = {}): q.Sql {
  return postgres(url, {
    max: 3,
    idle_timeout: 120,
    connect_timeout: 10,
    onnotice: () => {},
    connection: {
      application_name: 'rivianmate',
      default_transaction_read_only: true,
      statement_timeout: 20_000,
      ...extra,
    },
  });
}

/** A connection error in words the settings page can show. */
export function describeConnectionError(err: unknown): string {
  if (err instanceof q.NotTeslaMateError) return err.message;
  const e = err as { code?: string; message?: string; address?: string; port?: number };
  switch (e.code) {
    case 'ECONNREFUSED':
      return "Couldn't connect: nothing is listening at that host and port.";
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return "Couldn't find that host.";
    case 'ETIMEDOUT':
    case 'CONNECT_TIMEOUT':
      return 'Timed out connecting to the database.';
    case '28P01':
    case '28000':
      return 'The database rejected the user name or password.';
    case '3D000':
      return "That database doesn't exist.";
    case '42501':
      return 'The user can’t read TeslaMate’s tables. Grant it SELECT on them.';
    default:
      return e.message ?? String(err);
  }
}

/** The connection URL without its password, for display. */
export function previewUrl(url: string): string | null {
  try {
    const u = new URL(url);
    u.password = '';
    u.search = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export function isPostgresUrl(url: string): boolean {
  try {
    return ['postgres:', 'postgresql:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

interface Car {
  row: CarRow;
  dto: VehicleDto;
}

/**
 * Reads cars, drives and charging from a TeslaMate database, read-only,
 * and publishes each car's live state on the bus like the Rivian monitor
 * does. TeslaMate writes positions and charge readings every few seconds
 * while a car drives or charges, so polling it keeps pages live.
 */
export class TeslaMateSource {
  private sql?: q.Sql;
  private url?: string;
  private columns: q.Columns = { tpms: false, marketingName: false };
  private range: RangeKind = 'rated';
  private cars: Car[] = [];
  private geofences: GeofenceRow[] = [];
  private carsAt = 0;
  private states = new Map<string, VehicleState>();
  private stateJson = new Map<string, string>();
  private sessionJson = new Map<string, string>();
  private timer?: NodeJS.Timeout;
  private failures = 0;
  private lastError: string | null = null;
  private lastReadAt: Date | null = null;
  /** Bumped on every (re)configure so a superseded poll stops. */
  private generation = 0;

  constructor(
    private readonly bus: LiveBus,
    private readonly log: Logger = silentLogger,
    private readonly sessionParams: Record<string, string> = {},
  ) {}

  /** Checks a URL reaches a TeslaMate database, without keeping it. */
  async test(url: string): Promise<{ cars: number }> {
    const sql = connectReadOnly(url, this.sessionParams);
    try {
      const columns = await q.probe(sql);
      return { cars: (await q.cars(sql, columns)).length };
    } catch (err) {
      throw new Error(describeConnectionError(err), { cause: err });
    } finally {
      await sql.end({ timeout: 5 });
    }
  }

  get configured(): boolean {
    return this.url != null;
  }

  get connected(): boolean {
    return this.sql != null && this.lastError == null && this.lastReadAt != null;
  }

  status() {
    return {
      configured: this.configured,
      preview: this.url ? previewUrl(this.url) : null,
      connected: this.connected,
      error: this.lastError,
      lastReadAt: this.lastReadAt?.toISOString() ?? null,
      vehicles: this.getVehicles(),
    };
  }

  /**
   * Starts reading from `url`, or stops with null. Resolves after the first
   * read (successful or not); failures are retried in the background.
   */
  async configure(url: string | null): Promise<void> {
    await this.stop();
    if (!url) return;
    this.url = url;
    const generation = ++this.generation;
    this.sql = connectReadOnly(url, this.sessionParams);
    await this.tick(generation);
  }

  async stop(): Promise<void> {
    this.generation++;
    clearTimeout(this.timer);
    this.timer = undefined;
    const sql = this.sql;
    this.sql = undefined;
    this.url = undefined;
    this.lastError = null;
    this.lastReadAt = null;
    this.failures = 0;
    this.carsAt = 0;
    const gone = this.cars.map((c) => c.dto.id);
    this.cars = [];
    this.geofences = [];
    this.states.clear();
    this.stateJson.clear();
    this.sessionJson.clear();
    for (const id of gone) this.bus.emitChargingSession(id, null);
    await sql?.end({ timeout: 5 }).catch(() => {});
  }

  getVehicles(): VehicleDto[] {
    return this.cars.map((c) => c.dto);
  }

  getState(vehicleId: string): VehicleState | undefined {
    return this.states.get(vehicleId);
  }

  private async tick(generation: number): Promise<void> {
    let delay: number;
    try {
      delay = await this.poll(generation);
      if (this.lastError) this.log.info('TeslaMate reads working again');
      this.failures = 0;
      this.lastError = null;
      this.lastReadAt = new Date();
    } catch (err) {
      if (generation !== this.generation) return;
      const message = describeConnectionError(err);
      if (message !== this.lastError) this.log.warn({ err }, `TeslaMate read failed: ${message}`);
      this.lastError = message;
      this.failures++;
      delay = Math.min(MAX_RETRY_MS, ACTIVE_POLL_MS * 2 ** this.failures);
    }
    if (generation !== this.generation) return;
    this.timer = setTimeout(() => void this.tick(generation), delay);
    this.timer.unref();
  }

  /** Reads every car's latest state; returns how soon to read again. */
  private async poll(generation: number): Promise<number> {
    const sql = this.db();
    if (this.carsAt === 0 || Date.now() - this.carsAt > CARS_REFRESH_MS) {
      this.columns = await q.probe(sql);
      this.range = await q.preferredRange(sql);
      this.geofences = await q.geofences(sql);
      const rows = await q.cars(sql, this.columns);
      if (generation !== this.generation) return IDLE_POLL_MS;
      this.cars = rows.map((row) => ({ row, dto: toVehicleDto(row) }));
      this.carsAt = Date.now();
    }
    let delay = IDLE_POLL_MS;
    for (const car of this.cars) {
      const snap = await this.snapshot(car.row.id);
      if (generation !== this.generation) return IDLE_POLL_MS;
      const id = car.dto.id;
      const state = buildVehicleState(snap, this.range);
      this.states.set(id, state);
      const stateJson = JSON.stringify(state);
      if (stateJson !== this.stateJson.get(id)) {
        this.stateJson.set(id, stateJson);
        this.bus.emitState(id, state);
      }
      const session = liveChargingSession(snap, this.range, car.row.efficiency);
      const sessionJson = JSON.stringify(session && { ...session, timeElapsed: null });
      if (sessionJson !== this.sessionJson.get(id)) {
        this.sessionJson.set(id, sessionJson);
        this.bus.emitChargingSession(id, session);
      }
      if (snap.driveId != null || snap.charging != null) delay = ACTIVE_POLL_MS;
      else if (snap.state?.state === 'online' && snap.state.end_date == null)
        delay = Math.min(delay, ONLINE_POLL_MS);
    }
    return delay;
  }

  private async snapshot(carId: number): Promise<CarSnapshot> {
    const sql = this.db();
    const [full, state, drive, charge, version] = await Promise.all([
      q.latestFullPosition(sql, this.columns, carId),
      q.currentState(sql, carId),
      q.openDrive(sql, carId),
      q.openCharge(sql, carId),
      q.latestVersion(sql, carId),
    ]);
    const fresh = (date: Date | null | undefined) =>
      date != null && Date.now() - date.getTime() < ACTIVE_STALE_MS;
    const moving = drive ? (await q.drivePositionEdges(sql, this.columns, drive.id)).latest : null;
    const driving = drive != null && fresh(moving?.date ?? drive.started_at);
    const latestCharge = charge ? await q.latestCharge(sql, charge.id) : null;
    const charging = charge != null && fresh(latestCharge?.date ?? charge.start_date);
    return {
      full,
      moving: driving ? moving : null,
      state,
      driveId: driving ? drive.id : null,
      charging: charging ? { process: charge, latest: latestCharge } : null,
      version: version ? { version: softwareVersion(version.version) ?? '', at: version.at } : null,
    };
  }

  private db(): q.Sql {
    if (!this.sql) throw new Error('TeslaMate is not configured');
    return this.sql;
  }

  /** The car for a vehicle id, or null when it isn't one TeslaMate has. */
  private need(vehicleId: string): Car | null {
    if (!this.sql) return null;
    const carId = teslamateCarId(vehicleId);
    return this.cars.find((c) => c.row.id === carId) ?? null;
  }

  async drives(vehicleId: string, places: Places, window: ListWindow): Promise<DriveDto[]> {
    const car = this.need(vehicleId);
    if (!car) return [];
    const sql = this.db();
    const rows = await q.drives(sql, car.row.id, window);
    // Open drives' figures come from their positions: the one under way, and
    // any TeslaMate abandoned (a handful, over years).
    const open = rows.filter((r) => r.ended_at == null);
    const progress = new Map(
      await Promise.all(
        open.map(async (r) => [r.id, await this.progress(r.id, r.superseded)] as const),
      ),
    );
    return rows.map((row) =>
      toDriveDto(row, {
        range: this.range,
        efficiency: car.row.efficiency,
        places,
        progress: progress.get(row.id) ?? null,
        geofences: this.geofences,
      }),
    );
  }

  /** When the car's drives in TeslaMate start. */
  async driveCoverage(vehicleId: string): Promise<DriveCoverageDto> {
    const car = this.need(vehicleId);
    if (!car) return { since: null };
    const first = await q.firstDriveStart(this.db(), car.row.id);
    return { since: first?.toISOString() ?? null };
  }

  async drive(vehicleId: string, driveId: number, places: Places): Promise<DriveDetailDto | null> {
    const car = this.need(vehicleId);
    if (!car || !Number.isSafeInteger(driveId)) return null;
    const sql = this.db();
    const row = await q.drive(sql, car.row.id, driveId);
    if (!row) return null;
    const abandoned = row.ended_at == null && row.superseded;
    const points = await q.drivePoints(sql, driveId, MAX_DRIVE_POINTS, abandoned);
    const progress =
      row.ended_at == null
        ? {
            ...(await this.progress(driveId, abandoned)),
            altitudes: points.flatMap((p) => (p.elevation != null ? [p.elevation] : [])),
          }
        : null;
    return {
      ...toDriveDto(row, {
        range: this.range,
        efficiency: car.row.efficiency,
        places,
        progress,
        geofences: this.geofences,
      }),
      points: points.map((p) => ({
        ts: p.ts.toISOString(),
        lat: p.lat,
        lon: p.lon,
        speedKmh: p.speed,
        bearing: null,
        altitude: p.elevation,
      })),
    };
  }

  /**
   * An open drive's figures from its positions: so far, for the one under
   * way; up to where the car stopped, for one TeslaMate abandoned.
   */
  private async progress(driveId: number, abandoned: boolean): Promise<DriveProgress> {
    const sql = this.db();
    const [edges, latestFull, maxSpeed] = await Promise.all([
      q.drivePositionEdges(sql, this.columns, driveId, abandoned),
      q.latestFullDrivePosition(sql, this.columns, driveId, abandoned),
      q.driveMaxSpeed(sql, driveId, abandoned),
    ]);
    return { ...edges, latestFull, maxSpeed };
  }

  async chargingSessions(
    vehicleId: string,
    places: Places,
    window: ListWindow,
  ): Promise<ChargingSessionDto[]> {
    const car = this.need(vehicleId);
    if (!car) return [];
    const rows = await q.chargingProcesses(this.db(), car.row.id, window);
    return rows.map((row) => toSessionDto(row, { vehicleId, range: this.range, places }));
  }

  async chargingCurve(vehicleId: string, sessionId: number): Promise<ChargingCurvePointDto[]> {
    const car = this.need(vehicleId);
    if (!car || !Number.isSafeInteger(sessionId)) return [];
    const rows = await q.chargeCurve(this.db(), car.row.id, sessionId);
    return rows.map((r) => ({ ts: r.ts.toISOString(), powerKw: r.power_kw, soc: r.soc }));
  }

  async history(
    vehicleId: string,
    query: { metric: q.HistoryMetric; from: Date; to: Date; bucket: string },
  ): Promise<HistoryPoint[]> {
    const car = this.need(vehicleId);
    if (!car) return [];
    const rows = await q.history(this.db(), car.row.id, {
      metric: query.metric,
      from: query.from,
      to: query.to,
      interval: BUCKET_INTERVALS[query.bucket] ?? null,
      range: this.range,
    });
    return rows.map((r) => ({
      bucket: r.bucket.toISOString(),
      avg: r.avg,
      min: r.min,
      max: r.max,
    }));
  }

  /** What the car was doing over time, from TeslaMate's states, drives, charges and updates. */
  async stateSpans(vehicleId: string, from: Date, to: Date): Promise<StateSpanDto[]> {
    const car = this.need(vehicleId);
    if (!car) return [];
    const sql = this.db();
    const [intervals, charges] = await Promise.all([
      q.activityIntervals(sql, car.row.id, from, to),
      q.chargeIntervals(sql, car.row.id, from, to),
    ]);
    return activitySpans(
      [...intervals, ...charges.map((c) => ({ kind: 'charging' as const, ...c }))],
      from,
      to,
    );
  }

  async chargeSpans(vehicleId: string, from: Date, to: Date): Promise<ChargeSpanDto[]> {
    const car = this.need(vehicleId);
    if (!car) return [];
    const rows = await q.chargeIntervals(this.db(), car.row.id, from, to);
    return rows.map((r) => ({
      kind: 'charging',
      from: r.from.toISOString(),
      to: r.to.toISOString(),
    }));
  }

  async locations(vehicleId: string, from: Date, to: Date): Promise<LocationPointDto[]> {
    const car = this.need(vehicleId);
    if (!car) return [];
    const rows = await q.locations(this.db(), car.row.id, from, to, MAX_LOCATION_ROWS);
    const kept = thinTrack(rows, (r) => r.drive_id, trackToleranceM(from, to));
    return kept.map((r) => ({
      ts: r.ts.toISOString(),
      lat: r.lat,
      lon: r.lon,
      speedKmh: r.speed,
      bearing: null,
      altitude: r.elevation,
      // Groups the points into routes on the map.
      driveId: r.drive_id,
    }));
  }

  async phantomDrain(vehicleId: string, days: number, timeZone: string): Promise<PhantomDrainDto> {
    const car = this.need(vehicleId);
    if (!car) return { days: [], avgPctPerDay: null };
    const since = new Date(Date.now() - days * 86_400_000);
    const sql = this.db();
    const [rows, charges] = await Promise.all([
      q.drainRows(sql, car.row.id, since),
      q.chargeIntervals(sql, car.row.id, since, new Date()),
    ]);
    // TeslaMate keeps logging positions while charging; those aren't parked.
    const charging = (ts: Date) => charges.some((c) => ts >= c.from && ts <= c.to);
    const snapshots: DrainSnapshot[] = rows.map((r) => ({
      ts: r.ts,
      batteryLevel: r.battery_level,
      mileageM: r.odometer != null ? r.odometer * 1000 : null,
      chargerStatus: charging(r.ts) ? 'chrgr_sts_connected_charging' : null,
      gear: r.driving ? 'drive' : 'park',
    }));
    return phantomDrain(snapshots, timeZone);
  }

  /**
   * Battery lost while parked and unplugged over [from, to], as the Rivian
   * side measures it: from where each drive or charge left off to where the
   * next picked up.
   */
  private async parked(carId: number, from: Date, to: Date) {
    const sql = this.db();
    const [spans, levels] = await Promise.all([
      q.busySpans(sql, carId, from, to),
      q.batteryLevels(sql, carId, from, to),
    ]);
    const levelAt = (t: Date) =>
      levels.findLast((r) => r.at <= t)?.level ?? levels[0]?.level ?? null;
    return { ...parkedLoss(spans, from, to, levelAt), levels };
  }

  /** Usable capacity (kWh) and range per percent of charge, for turning percent into both. */
  private async scale(vehicleId: string, carId: number, efficiency: number | null) {
    const capacity = capacityHistory(await q.capacityRows(this.db(), carId), efficiency);
    const state = this.states.get(vehicleId);
    const level = state ? stateNumber(state, 'batteryLevel') : null;
    const range = state ? stateNumber(state, 'distanceToEmpty') : null;
    return {
      kwh: capacity.latest?.kwh ?? null,
      kmPerPct: level != null && level > 0 && range != null ? range / level : null,
    };
  }

  /**
   * What the dashboard reads beside the state. Only energy used while parked
   * comes from TeslaMate, over the last day and week; it isn't split by use.
   */
  async insights(vehicleId: string): Promise<VehicleInsightsDto> {
    const car = this.need(vehicleId);
    if (!car) return EMPTY_INSIGHTS;
    const now = new Date();
    const { kwh, kmPerPct } = await this.scale(vehicleId, car.row.id, car.row.efficiency);
    if (kwh == null) return EMPTY_INSIGHTS;
    const windows = await Promise.all(
      PARKED_WINDOW_MINUTES.map(async (minutes) => {
        const from = new Date(now.getTime() - minutes * 60_000);
        const { lossPct } = await this.parked(car.row.id, from, now);
        return {
          minutes,
          kwh: (lossPct / 100) * kwh,
          rangeKm: kmPerPct != null ? lossPct * kmPerPct : 0,
          uses: null,
        };
      }),
    );
    return { ...EMPTY_INSIGHTS, parkedEnergy: { windows, at: now.toISOString() } };
  }

  /** The battery over a window, as History's balance reads it. */
  async batteryWindow(vehicleId: string, from: Date, to: Date): Promise<BatteryWindowDto> {
    const car = this.need(vehicleId);
    if (!car) {
      return {
        capacityKwh: null,
        startLevel: null,
        endLevel: null,
        parkedLossPct: 0,
        parkedHours: 0,
      };
    }
    const [{ lossPct, parkedHours, levels }, { kwh }] = await Promise.all([
      this.parked(car.row.id, from, to),
      this.scale(vehicleId, car.row.id, car.row.efficiency),
    ]);
    const within = levels.filter((r) => r.at >= from);
    return {
      capacityKwh: kwh,
      startLevel: within[0]?.level ?? null,
      endLevel: within.at(-1)?.level ?? null,
      parkedLossPct: lossPct,
      parkedHours,
    };
  }

  async tirePressures(vehicleId: string, days: number): Promise<TirePressurePointDto[]> {
    const car = this.need(vehicleId);
    if (!car) return [];
    const since = new Date(Date.now() - days * 86_400_000);
    const interval = days <= 7 ? '1 hour' : days <= 30 ? '6 hours' : '1 day';
    const rows = await q.tirePressures(this.db(), this.columns, car.row.id, since, interval);
    return rows.map((r) => ({
      ts: r.bucket.toISOString(),
      frontLeft: r.front_left,
      frontRight: r.front_right,
      rearLeft: r.rear_left,
      rearRight: r.rear_right,
    }));
  }

  async batteryHealth(vehicleId: string): Promise<BatteryHealthDto> {
    const car = this.need(vehicleId);
    if (!car) return { latest: null, reported: [], ratedCapacity: null };
    const rows = await q.capacityRows(this.db(), car.row.id);
    return capacityHistory(rows, car.row.efficiency);
  }

  async ota(vehicleId: string): Promise<OtaTimelineDto> {
    const car = this.need(vehicleId);
    if (!car) return { current: null, available: null, versions: [] };
    const rows = await q.versions(this.db(), car.row.id);
    // Builds of one version ("2024.26.7 a1b2…", "2024.26.7 c3d4…") count once.
    const seen = new Map<string, Date>();
    for (const r of rows) {
      const version = softwareVersion(r.version);
      if (!version) continue;
      const first = seen.get(version);
      if (!first || r.first_seen < first) seen.set(version, r.first_seen);
    }
    const versions = [...seen]
      .sort(([, a], [, b]) => b.getTime() - a.getTime())
      .map(([version, firstSeen]) => ({
        version,
        firstSeen: firstSeen.toISOString(),
        hasNotes: false,
      }));
    return { current: versions[0]?.version ?? null, available: null, versions };
  }
}
