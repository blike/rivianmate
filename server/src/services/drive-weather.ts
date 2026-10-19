import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { type Logger, silentLogger } from '../logger.js';
import { drives, locationPoints } from '../db/schema.js';
import { MIN_DRIVE_KM } from './drive-metrics.js';
import { isPosition } from './state-utils.js';

export interface WeatherPoint {
  lat: number;
  lon: number;
}

/**
 * Temperatures (°C) at times (ms), ascending; gaps left out. Wind (km/h,
 * and degrees it blows from) and WMO weather codes line up with them, null
 * where the model has none.
 */
export interface TemperatureSeries {
  times: number[];
  tempsC: number[];
  windKmh?: (number | null)[];
  windDirDeg?: (number | null)[];
  codes?: (number | null)[];
}

/** One series per point, in order, covering `from` to `to`. */
export type TemperatureLookup = (
  points: readonly WeatherPoint[],
  from: Date,
  to: Date,
) => Promise<TemperatureSeries[]>;

/** Open-Meteo's limit was hit; back off rather than retry. */
export class RateLimitedError extends Error {}

/** Open-Meteo refused the request itself (e.g. dates it has no data for); retrying soon won't help. */
export class LookupRejectedError extends Error {}

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
/** Archived high-resolution model runs, for days the forecast API no longer keeps. */
const HISTORICAL_URL = 'https://historical-forecast-api.open-meteo.com/v1/forecast';
/** The forecast API keeps about 92 days; switch well before that. */
const HISTORICAL_AFTER_MS = 80 * 86400_000;

/**
 * Open-Meteo: free model data (CC BY 4.0), no key needed, several points
 * per request. 15-minute data where the models have it (North America,
 * Europe), hourly elsewhere and for older days. Open-Meteo corrects for
 * terrain height itself, so no elevation is sent.
 */
export function openMeteoTemperatures(
  userAgent: string,
  fetchFn: typeof fetch = fetch,
  now: () => number = Date.now,
): TemperatureLookup {
  return async (points, from, to) => {
    const historical = now() - from.getTime() > HISTORICAL_AFTER_MS;
    const params = new URLSearchParams({
      latitude: points.map((p) => p.lat.toFixed(4)).join(','),
      longitude: points.map((p) => p.lon.toFixed(4)).join(','),
      minutely_15: WEATHER_VARIABLES,
      hourly: WEATHER_VARIABLES,
      start_date: utcDate(from),
      end_date: utcDate(to),
      timeformat: 'unixtime',
    });
    const res = await fetchFn(`${historical ? HISTORICAL_URL : FORECAST_URL}?${params}`, {
      headers: { 'User-Agent': userAgent, Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 429) throw new RateLimitedError('Open-Meteo rate limit');
    if (res.status === 400) {
      const body = (await res.json().catch(() => null)) as { reason?: string } | null;
      throw new LookupRejectedError(
        `Open-Meteo rejected the request: ${body?.reason ?? 'HTTP 400'}`,
      );
    }
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    return parseOpenMeteo(await res.json(), points.length);
  };
}

const WEATHER_VARIABLES = 'temperature_2m,wind_speed_10m,wind_direction_10m,weather_code';

interface OpenMeteoBlock {
  time?: number[];
  temperature_2m?: (number | null)[];
  wind_speed_10m?: (number | null)[];
  wind_direction_10m?: (number | null)[];
  weather_code?: (number | null)[];
}

interface OpenMeteoLocation {
  minutely_15?: OpenMeteoBlock;
  hourly?: OpenMeteoBlock;
}

/**
 * One series per requested point. Open-Meteo answers one point with an
 * object and several with an array. 15-minute values are used when there
 * are any, hourly ones otherwise.
 */
export function parseOpenMeteo(body: unknown, count: number): TemperatureSeries[] {
  const list = (Array.isArray(body) ? body : [body]) as OpenMeteoLocation[];
  if (list.length !== count) {
    throw new Error(`Open-Meteo returned ${list.length} locations for ${count}`);
  }
  return list.map((location) => {
    const fine = toSeries(location.minutely_15);
    return fine.times.length ? fine : toSeries(location.hourly);
  });
}

function toSeries(block: OpenMeteoBlock | undefined): TemperatureSeries {
  const series = {
    times: [] as number[],
    tempsC: [] as number[],
    windKmh: [] as (number | null)[],
    windDirDeg: [] as (number | null)[],
    codes: [] as (number | null)[],
  };
  const times = block?.time ?? [];
  const temps = block?.temperature_2m ?? [];
  const value = (list: (number | null)[] | undefined, i: number) => {
    const v = list?.[i];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    const c = temps[i];
    if (typeof t === 'number' && typeof c === 'number' && Number.isFinite(c)) {
      series.times.push(t * 1000);
      series.tempsC.push(c);
      series.windKmh.push(value(block?.wind_speed_10m, i));
      series.windDirDeg.push(value(block?.wind_direction_10m, i));
      series.codes.push(value(block?.weather_code, i));
    }
  }
  return series;
}

const utcDate = (d: Date) => d.toISOString().slice(0, 10);

/** How far past the series' ends a value is still taken from the nearest one. */
const EDGE_MS = 60 * 60_000;

/** Linear between the values either side of `t`; null without data near it. */
export function interpolateAt(series: TemperatureSeries, t: number): number | null {
  const { times, tempsC } = series;
  if (!times.length) return null;
  if (t <= times[0]!) return times[0]! - t <= EDGE_MS ? tempsC[0]! : null;
  const last = times.length - 1;
  if (t >= times[last]!) return t - times[last]! <= EDGE_MS ? tempsC[last]! : null;
  const hi = times.findIndex((x) => x >= t);
  if (times[hi] === t) return tempsC[hi]!;
  const lo = hi - 1;
  const f = (t - times[lo]!) / (times[hi]! - times[lo]!);
  return tempsC[lo]! + f * (tempsC[hi]! - tempsC[lo]!);
}

export interface Conditions {
  windKmh: number | null;
  windDirDeg: number | null;
  weatherCode: number | null;
}

/**
 * Wind and weather code from the model step nearest `t`: codes don't blend,
 * and at 15-minute steps neither needs to. Null without data near it.
 */
export function conditionsAt(series: TemperatureSeries, t: number): Conditions {
  const { times } = series;
  let best = -1;
  for (let i = 0; i < times.length; i++) {
    if (best < 0 || Math.abs(times[i]! - t) < Math.abs(times[best]! - t)) best = i;
  }
  if (best < 0 || Math.abs(times[best]! - t) > EDGE_MS) {
    return { windKmh: null, windDirDeg: null, weatherCode: null };
  }
  return {
    windKmh: series.windKmh?.[best] ?? null,
    windDirDeg: series.windDirDeg?.[best] ?? null,
    weatherCode: series.codes?.[best] ?? null,
  };
}

export interface TrackPoint {
  ts: Date;
  lat: number;
  lon: number;
}

/**
 * The first point, then the first one at least `intervalMs` after the last
 * kept; with `includeLast`, the final point too.
 */
export function sampleTrack(
  points: readonly TrackPoint[],
  intervalMs: number,
  includeLast: boolean,
): TrackPoint[] {
  const kept: TrackPoint[] = [];
  for (const p of points) {
    const prev = kept.at(-1);
    if (!prev || p.ts.getTime() - prev.ts.getTime() >= intervalMs) kept.push(p);
  }
  const last = points.at(-1);
  if (includeLast && last && kept.at(-1) !== last) kept.push(last);
  return kept;
}

/** Average over time (trapezoids), so a stretch sampled closely doesn't count extra. */
export function timeWeightedAverage(
  samples: readonly { ts: Date; tempC: number }[],
): number | null {
  if (!samples.length) return null;
  const span = samples.at(-1)!.ts.getTime() - samples[0]!.ts.getTime();
  if (span <= 0) return samples.reduce((sum, s) => sum + s.tempC, 0) / samples.length;
  let area = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    area += ((a.tempC + b.tempC) / 2) * (b.ts.getTime() - a.ts.getTime());
  }
  return area / span;
}

/** Weather at one point along a drive. */
export interface WeatherReading extends Conditions {
  ts: Date;
  tempC: number;
}

export interface WeatherSummary {
  avgC: number;
  minC: number;
  maxC: number;
  /** The drive's conditions: the commonest code, unless it was wet for a good part of it. */
  weatherCode: number | null;
  windKmh: number | null;
  /** Where the wind mostly blew from (degrees), weighted by its speed. */
  windFromDeg: number | null;
}

/** Drizzle and up: rain, snow, showers, storms. */
const WET = 51;
/** Wet weather for at least this share of the drive names the drive. */
const WET_SHARE = 0.25;

/** The weather over a drive, from the readings along it; null without any. */
export function summarizeWeather(readings: readonly WeatherReading[]): WeatherSummary | null {
  if (!readings.length) return null;
  const temps = readings.map((r) => r.tempC);

  const codes = readings.flatMap((r) => (r.weatherCode == null ? [] : [r.weatherCode]));
  const count = new Map<number, number>();
  for (const c of codes) count.set(c, (count.get(c) ?? 0) + 1);
  // Commonest first; on a tie, the worse weather.
  const ranked = [...count.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const wet = ranked.find(([c, n]) => c >= WET && n / codes.length >= WET_SHARE);

  const winds = readings.filter((r) => r.windKmh != null);
  let x = 0;
  let y = 0;
  for (const r of winds) {
    if (r.windDirDeg == null) continue;
    const rad = (r.windDirDeg * Math.PI) / 180;
    x += r.windKmh! * Math.sin(rad);
    y += r.windKmh! * Math.cos(rad);
  }
  const calm = Math.hypot(x, y) < 1e-9;

  return {
    avgC: timeWeightedAverage(readings)!,
    minC: Math.min(...temps),
    maxC: Math.max(...temps),
    weatherCode: (wet ?? ranked[0])?.[0] ?? null,
    windKmh: winds.length ? winds.reduce((sum, r) => sum + r.windKmh!, 0) / winds.length : null,
    windFromDeg: calm ? null : ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360,
  };
}

/**
 * A reading every 10 minutes of driving. The model data comes in 15-minute
 * steps, so closer samples add little: against every 3 minutes, averages
 * stayed within 0.2 °C and conditions matched.
 */
export const SAMPLE_INTERVAL_MS = 10 * 60_000;
/** Lookups still to do are checked this often. */
const PASS_MS = 3 * 60_000;
const REQUEST_SPACING_MS = 1_100;
/** Keeps request URLs short. */
const MAX_POINTS_PER_REQUEST = 50;
/**
 * Open-Meteo counts each point as a call; its free tier allows 5,000 an
 * hour and 10,000 a day. Stay well under, so a long backlog spreads out.
 */
const HOURLY_BUDGET = 2_000;
const DAILY_BUDGET = 5_000;
const BACKLOG_BATCH = 200;
const MAX_BACKOFF_MS = 60 * 60_000;

/** The call budget is spent for now; the next pass tries again. */
class BudgetSpent extends Error {}

export interface DriveWeatherOptions {
  spacingMs?: number;
  passMs?: number;
  hourlyBudget?: number;
  dailyBudget?: number;
  now?: () => number;
}

/**
 * Records the weather of each drive once it ends, including drives that
 * ended before RivianMate could look them up: the route every 10 minutes is
 * looked up, and the readings summed up on the drive. A failed lookup
 * leaves the drive pending; passes then back off until one succeeds.
 */
export class DriveWeather {
  private queue: number[] = [];
  private running = false;
  private stopped = true;
  private timer?: ReturnType<typeof setInterval>;
  private lastRequestAt = 0;
  private calls: { at: number; count: number }[] = [];
  private backoffMs = 0;
  private retryAt = 0;
  /** Drives Open-Meteo refused, left alone until the next restart. */
  private readonly skipped = new Set<number>();
  private readonly now: () => number;

  constructor(
    private readonly db: Db,
    private readonly lookup: TemperatureLookup,
    private readonly log: Logger = silentLogger,
    private readonly options: DriveWeatherOptions = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  /** Queues drives still to look up, then checks again every few minutes. */
  async start(): Promise<void> {
    this.stopped = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.enqueuePending().catch((err: unknown) =>
        this.log.warn({ err }, 'could not list drives for temperature lookups'),
      );
    }, this.options.passMs ?? PASS_MS);
    this.timer.unref?.();
    await this.enqueuePending();
  }

  stop(): void {
    this.stopped = true;
    this.queue = [];
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  enqueue(driveId: number): void {
    if (this.stopped || this.now() < this.retryAt) return;
    if (this.skipped.has(driveId) || this.queue.includes(driveId)) return;
    this.queue.push(driveId);
    void this.drain();
  }

  /** Resolves once the queue is empty (for tests). */
  async idle(): Promise<void> {
    while (this.running || this.queue.length > 0) await new Promise((r) => setTimeout(r, 10));
  }

  /** Ended drives not yet looked up, newest first. */
  private async enqueuePending(): Promise<void> {
    if (this.stopped || this.now() < this.retryAt) return;
    const pending = await this.db
      .select({ id: drives.id })
      .from(drives)
      .where(
        and(
          isNull(drives.weatherCheckedAt),
          isNotNull(drives.endedAt),
        ),
      )
      .orderBy(desc(drives.startedAt))
      .limit(BACKLOG_BATCH);
    for (const { id } of pending) this.enqueue(id);
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (!this.stopped && this.queue.length > 0) {
        const driveId = this.queue.shift()!;
        try {
          await this.fill(driveId);
          this.backoffMs = 0;
        } catch (err) {
          if (err instanceof LookupRejectedError) {
            // Skip this drive until the next restart and go on with the rest.
            this.log.warn({ err, driveId }, 'temperature lookup rejected; skipping the drive');
            this.skipped.add(driveId);
            continue;
          }
          this.queue = [];
          if (err instanceof BudgetSpent) {
            this.log.debug('temperature lookup budget spent; continuing later');
            break;
          }
          // Back off 3, 6, 12… minutes, up to an hour; warn once per outage.
          if (this.backoffMs === 0) this.log.warn({ err, driveId }, 'temperature lookup failed');
          else this.log.debug({ err, driveId }, 'temperature lookup failed again');
          this.backoffMs = Math.min(
            MAX_BACKOFF_MS,
            this.backoffMs ? this.backoffMs * 2 : (this.options.passMs ?? PASS_MS),
          );
          this.retryAt = this.now() + this.backoffMs;
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async fill(driveId: number): Promise<void> {
    const [drive] = await this.db.select().from(drives).where(eq(drives.id, driveId));
    // Looked up once, when the whole route is in.
    if (!drive?.endedAt || drive.weatherCheckedAt) return;
    // Hidden as a non-drive (gear check), so not worth a lookup.
    if (drive.distanceKm != null && drive.distanceKm < MIN_DRIVE_KM) {
      await this.db
        .update(drives)
        .set({ weatherCheckedAt: new Date() })
        .where(eq(drives.id, driveId));
      return;
    }

    let route: TrackPoint[] = (
      await this.db
        .select({ ts: locationPoints.ts, lat: locationPoints.lat, lon: locationPoints.lon })
        .from(locationPoints)
        .where(eq(locationPoints.driveId, driveId))
        .orderBy(asc(locationPoints.ts))
    ).filter((p) => isPosition(p.lat, p.lon));
    if (!route.length) {
      // No GPS track: where it started and ended will do.
      route = [
        { ts: drive.startedAt, lat: drive.startLat, lon: drive.startLon },
        { ts: drive.endedAt, lat: drive.endLat, lon: drive.endLon },
      ].filter((p): p is TrackPoint => p.ts != null && isPosition(p.lat, p.lon));
    }

    const samples = sampleTrack(route, SAMPLE_INTERVAL_MS, true);
    const readings: WeatherReading[] = [];
    for (let i = 0; i < samples.length; i += MAX_POINTS_PER_REQUEST) {
      const chunk = samples.slice(i, i + MAX_POINTS_PER_REQUEST);
      await this.reserve(chunk.length);
      const series = await this.lookup(chunk, chunk[0]!.ts, chunk.at(-1)!.ts);
      chunk.forEach((s, j) => {
        const tempC = interpolateAt(series[j]!, s.ts.getTime());
        if (tempC != null)
          readings.push({ ts: s.ts, tempC, ...conditionsAt(series[j]!, s.ts.getTime()) });
      });
    }

    const summary = summarizeWeather(readings);
    await this.db
      .update(drives)
      .set({
        avgOutsideTempC: summary?.avgC ?? null,
        minOutsideTempC: summary?.minC ?? null,
        maxOutsideTempC: summary?.maxC ?? null,
        weatherCode: summary?.weatherCode ?? null,
        windKmh: summary?.windKmh ?? null,
        windFromDeg: summary?.windFromDeg ?? null,
        weatherCheckedAt: new Date(),
      })
      .where(eq(drives.id, driveId));
  }

  /** Waits its turn, or throws BudgetSpent if `count` calls would go over budget. */
  private async reserve(count: number): Promise<void> {
    const now = this.now();
    this.calls = this.calls.filter((c) => now - c.at < 86400_000);
    const spent = (ms: number) =>
      this.calls.filter((c) => now - c.at < ms).reduce((sum, c) => sum + c.count, 0);
    if (
      spent(3600_000) + count > (this.options.hourlyBudget ?? HOURLY_BUDGET) ||
      spent(86400_000) + count > (this.options.dailyBudget ?? DAILY_BUDGET)
    ) {
      throw new BudgetSpent();
    }
    const wait = this.lastRequestAt + (this.options.spacingMs ?? REQUEST_SPACING_MS) - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRequestAt = Date.now();
    this.calls.push({ at: now, count });
  }
}
