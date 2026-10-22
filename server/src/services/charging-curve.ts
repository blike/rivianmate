/** Picking the one series a session's charging curve is drawn from. */
import type { LiveSessionData } from '../rivian/types.js';

export type CurveSource = 'observed' | 'graph' | 'push_chart' | 'push_live' | 'forecast' | 'legacy';

export interface CurvePoint {
  source: CurveSource;
  ts: Date;
  powerKw: number | null;
  soc: number | null;
}

/**
 * Recorded series, most trusted first: Parallax's charging graph is the
 * vehicle's own record; the push feed's chart is Rivian's; its current
 * readings are snapshots. Rows from before sources were kept apart come
 * last. The forecast is never a recorded series.
 */
const SOURCE_ORDER: readonly CurveSource[] = ['graph', 'push_chart', 'push_live', 'legacy'];

/** SoC can't climb more than this past the last powered point without power. */
const UNPOWERED_RISE_TOLERANCE = 1;

/** A series needs this many power readings to be drawn as a curve. */
const MIN_POWER_POINTS = 2;

/**
 * While plugged in, SoC can't fall more than this within the window
 * below. A point that does is a misread or a stray from another series,
 * not a reading.
 */
const SOC_DROP_TOLERANCE = 2;
const SOC_WINDOW_MS = 15 * 60_000;

/** How often the app samples a charge's power and battery level. */
export const OBSERVED_SAMPLE_MS = 60_000;

/**
 * Samples farther apart than this are a gap: the app wasn't running, or the
 * stream dropped. A recorded series fills it.
 */
const OBSERVED_GAP_MS = 5 * OBSERVED_SAMPLE_MS;

/** Power older than this is from before a pause, not a reading now. */
export const POWER_MAX_AGE_MS = 5 * 60_000;

/**
 * The curve from the app's own samples, without implausible SoC drops, with
 * points from a recorded series (see curveForDisplay) where there are none:
 * only those farther than a gap from every sample, so the two never
 * interleave.
 */
export function observedCurve(
  observed: readonly CurvePoint[],
  fill: readonly CurvePoint[],
): CurvePoint[] {
  // Not withoutUnpoweredRise: a sample's power is unknown, not zero, while
  // the power feed is quiet, and the level still rises.
  const own = withoutSocDrops([...observed].sort((a, b) => a.ts.getTime() - b.ts.getTime()));
  const times = own.map((p) => p.ts.getTime());
  const near = (t: number) => {
    // The first sample at or after t, and the one before it.
    let lo = 0;
    let hi = times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid]! < t) lo = mid + 1;
      else hi = mid;
    }
    return [times[lo - 1], times[lo]].some((s) => s != null && Math.abs(s - t) <= OBSERVED_GAP_MS);
  };
  return [...own, ...fill.filter((p) => !near(p.ts.getTime()))].sort(
    (a, b) => a.ts.getTime() - b.ts.getTime(),
  );
}

export interface LiveReading {
  at: number;
  field: 'powerKw' | 'soc';
  value: number;
}

/**
 * A sample a minute over each span it charged, plus one at the span's end,
 * from timestamped readings: each carries the latest power read within the
 * span (and in the last few minutes) and the latest battery level. This is
 * what the app records live, rebuilt from archived readings.
 */
export function minuteSamples(
  readings: readonly LiveReading[],
  spans: readonly { from: Date; to: Date }[],
): CurvePoint[] {
  const sorted = [...readings].sort((a, b) => a.at - b.at);
  const out: CurvePoint[] = [];
  for (const span of spans) {
    const from = span.from.getTime();
    const to = span.to.getTime();
    const times: number[] = [];
    for (let t = from; t < to; t += OBSERVED_SAMPLE_MS) times.push(t);
    times.push(to);
    let i = 0;
    let power: LiveReading | null = null;
    let soc: number | null = null;
    for (const t of times) {
      for (; i < sorted.length && sorted[i]!.at <= t; i++) {
        const r = sorted[i]!;
        if (r.field === 'soc') soc = r.value;
        else if (r.at >= from) power = r;
      }
      const powerKw = power && t - power.at <= POWER_MAX_AGE_MS ? power.value : null;
      if (powerKw == null && soc == null) continue;
      out.push({ source: 'observed', ts: new Date(t), powerKw, soc });
    }
  }
  return out;
}

/**
 * One source's points, in time order, without implausible SoC drops, over
 * the time it charged when that's known (see clipToCharging). Sources are
 * never interleaved: two series sampled at different moments zig-zag when
 * drawn as one line.
 */
export function curveForDisplay(
  points: readonly CurvePoint[],
  charging: { from: Date; to: Date } | null = null,
): CurvePoint[] {
  const bySource = (source: CurveSource) =>
    clipToCharging(
      points.filter((p) => p.source === source).sort((a, b) => a.ts.getTime() - b.ts.getTime()),
      charging,
    );
  for (const source of SOURCE_ORDER) {
    const series = bySource(source);
    if (series.filter((p) => p.powerKw != null).length >= MIN_POWER_POINTS)
      return plausible(series);
  }
  // No series has power: the first with anything (e.g. SoC only).
  for (const source of SOURCE_ORDER) {
    const series = bySource(source);
    if (series.length > 0) return plausible(series);
  }
  return [];
}

function plausible(series: readonly CurvePoint[]): CurvePoint[] {
  return withoutUnpoweredRise(withoutSocDrops(series));
}

/**
 * Drops trailing points whose SoC keeps rising after power stopped: a
 * battery can't gain charge without power, so these are a forecast that was
 * stored as readings (before forecasts were kept apart), not a record.
 */
function withoutUnpoweredRise(series: readonly CurvePoint[]): CurvePoint[] {
  let lastPowered = -1;
  for (let i = series.length - 1; i >= 0; i--) {
    if ((series[i]!.powerKw ?? 0) > 0) {
      lastPowered = i;
      break;
    }
  }
  if (lastPowered < 0) return [...series];
  // The highest SoC seen while charging, up to the last powered point.
  let socThen = -Infinity;
  for (let i = 0; i <= lastPowered; i++) socThen = Math.max(socThen, series[i]!.soc ?? -Infinity);
  if (!Number.isFinite(socThen)) return [...series];
  return series.filter(
    (p, i) =>
      i <= lastPowered ||
      (p.powerKw ?? 0) > 0 ||
      p.soc == null ||
      p.soc <= socThen + UNPOWERED_RISE_TOLERANCE,
  );
}

function withoutSocDrops(series: readonly CurvePoint[]): CurvePoint[] {
  const kept: CurvePoint[] = [];
  for (const point of series) {
    if (point.soc != null) {
      const since = point.ts.getTime() - SOC_WINDOW_MS;
      let recentMax = -Infinity;
      for (let i = kept.length - 1; i >= 0 && kept[i]!.ts.getTime() >= since; i--) {
        const soc = kept[i]!.soc;
        if (soc != null && soc > recentMax) recentMax = soc;
      }
      if (point.soc < recentMax - SOC_DROP_TOLERANCE) continue;
    }
    kept.push(point);
  }
  return kept;
}

/**
 * The vehicle's forecast for a charge in progress: its points after the
 * last recorded one, in time order. Empty once the charge has ended.
 */
export function forecastForDisplay(
  points: readonly CurvePoint[],
  recorded: readonly CurvePoint[],
  sessionOpen: boolean,
): CurvePoint[] {
  if (!sessionOpen) return [];
  const after = recorded.at(-1)?.ts.getTime() ?? -Infinity;
  return points
    .filter((p) => p.source === 'forecast' && p.soc != null && p.ts.getTime() > after)
    .sort((a, b) => a.ts.getTime() - b.ts.getTime());
}

/**
 * The recorded curve over just the time it charged. Graph bars are up to 32
 * minutes long, so a charge starts and stops partway through one: the
 * point covering the start moves to it, and one is added where it stopped,
 * with the level then (the next point's) and the power still flowing,
 * which Rivian leaves off the last bar once charging stops.
 */
export function clipToCharging(
  points: readonly CurvePoint[],
  window: { from: Date; to: Date } | null,
): CurvePoint[] {
  if (!window || points.length === 0) return [...points];
  const from = window.from.getTime();
  const to = window.to.getTime();
  const at = (p: CurvePoint) => p.ts.getTime();
  const out: CurvePoint[] = [];
  const opening = points.filter((p) => at(p) <= from).at(-1);
  if (opening) out.push({ ...opening, ts: new Date(from) });
  out.push(...points.filter((p) => at(p) > from && at(p) < to));
  const closing = points.find((p) => at(p) >= to);
  if (closing) {
    const power = out.filter((p) => p.powerKw != null).at(-1)?.powerKw ?? null;
    const last = out.at(-1);
    if (last && last.powerKw == null && power != null)
      out[out.length - 1] = { ...last, powerKw: power };
    out.push({ ...closing, ts: new Date(to), powerKw: power });
  }
  return out;
}

/** Estimates further out than this are a stale or misread time left. */
const MAX_ESTIMATE_MS = 48 * 3600_000;

/**
 * The app's own forecast, for a charge Rivian sends none for: a straight
 * line from the battery level now to the charge limit, reached when the
 * time left runs out. AC charging rises about evenly; a DC charge slows
 * near the top, so this runs ahead of it there. Empty without all three
 * readings, or once the level has reached the limit.
 */
export function estimatedForecast(
  live: Pick<LiveSessionData, 'soc' | 'socLimit' | 'timeRemaining'> | null,
): CurvePoint[] {
  const soc = numeric(live?.soc?.value);
  const limit = numeric(live?.socLimit?.value);
  const secondsLeft = numeric(live?.timeRemaining?.value);
  if (soc == null || limit == null || secondsLeft == null || limit <= soc || secondsLeft <= 0)
    return [];
  const fromMs = Date.parse(live!.soc!.updatedAt);
  const untilMs = Date.parse(live!.timeRemaining!.updatedAt) + secondsLeft * 1000;
  if (!Number.isFinite(fromMs) || !Number.isFinite(untilMs)) return [];
  if (untilMs <= fromMs || untilMs - fromMs > MAX_ESTIMATE_MS) return [];
  return [
    { source: 'forecast', ts: new Date(fromMs), powerKw: null, soc },
    { source: 'forecast', ts: new Date(untilMs), powerKw: null, soc: limit },
  ];
}

/**
 * The live session's battery level and power, as a point closing the
 * recorded curve: the graph adds one only at each bar boundary (up to 32
 * minutes apart), so the curve would otherwise stop short of the level
 * shown with it. Null without a level, or when it's no newer than `last`.
 */
export function liveCurvePoint(
  live: Pick<LiveSessionData, 'soc' | 'power'> | null,
  last: CurvePoint | undefined,
): CurvePoint | null {
  const soc = numeric(live?.soc?.value);
  const ts = live?.soc ? new Date(live.soc.updatedAt) : null;
  if (soc == null || !ts || !Number.isFinite(ts.getTime())) return null;
  if (last && ts.getTime() <= last.ts.getTime()) return null;
  return { source: last?.source ?? 'graph', ts, powerKw: numeric(live?.power?.value), soc };
}

/**
 * The curve with its first point at the battery level it charged from, when
 * that point has none: Rivian's first graph bar often carries power but no
 * SoC, which leaves the battery line starting a bar late.
 */
export function withOpeningSoc(curve: readonly CurvePoint[], soc: number | null): CurvePoint[] {
  const first = curve[0];
  if (!first || first.soc != null || soc == null) return [...curve];
  return [{ ...first, soc }, ...curve.slice(1)];
}

const numeric = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
