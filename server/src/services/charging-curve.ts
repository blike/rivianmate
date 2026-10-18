/** Picking the one series a session's charging curve is drawn from. */
import type { LiveSessionData } from '../rivian/types.js';

export type CurveSource = 'graph' | 'push_chart' | 'push_live' | 'forecast' | 'legacy';

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
