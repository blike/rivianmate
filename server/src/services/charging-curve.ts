/** Picking the one series a session's charging curve is drawn from. */

export type CurveSource = "graph" | "push_chart" | "push_live" | "legacy";

export interface CurvePoint {
  source: CurveSource;
  ts: Date;
  powerKw: number | null;
  soc: number | null;
}

/**
 * Most trusted first: Parallax's charging graph is the vehicle's own
 * record; the push feed's chart is Rivian's; its current readings are
 * snapshots. Rows from before sources were kept apart come last.
 */
const SOURCE_ORDER: readonly CurveSource[] = ["graph", "push_chart", "push_live", "legacy"];

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
 * One source's points, in time order, without implausible SoC drops.
 * Sources are never interleaved: two series sampled at different moments
 * zig-zag when drawn as one line.
 */
export function curveForDisplay(points: readonly CurvePoint[]): CurvePoint[] {
  const bySource = (source: CurveSource) =>
    points.filter((p) => p.source === source).sort((a, b) => a.ts.getTime() - b.ts.getTime());
  for (const source of SOURCE_ORDER) {
    const series = bySource(source);
    if (series.filter((p) => p.powerKw != null).length >= MIN_POWER_POINTS) return plausible(series);
  }
  // No series has power: the first with anything (e.g. SoC only).
  for (const source of SOURCE_ORDER) {
    const series = bySource(source);
    if (series.length > 0) return plausible(series);
  }
  return [];
}

function plausible(series: readonly CurvePoint[]): CurvePoint[] {
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
