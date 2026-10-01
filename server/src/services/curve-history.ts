/** Matching Rivian's latest-session power curve to recorded sessions. */

export interface CurvePoint {
  ts: Date;
  powerKw: number | null;
}

export interface SessionSpan {
  id: number;
  startedAt: Date;
  endedAt: Date | null;
}

const SLACK_MS = 2 * 60_000;

/**
 * Assigns each point to the session whose time span contains it (with a
 * little slack at both ends). Open sessions extend to `now`. Points that
 * fall outside every session are dropped.
 */
export function assignCurvePoints(
  points: readonly CurvePoint[],
  sessions: readonly SessionSpan[],
  now: number,
): Map<number, CurvePoint[]> {
  const result = new Map<number, CurvePoint[]>();
  for (const point of points) {
    const t = point.ts.getTime();
    if (!Number.isFinite(t)) continue;
    let best: SessionSpan | null = null;
    for (const s of sessions) {
      const start = s.startedAt.getTime() - SLACK_MS;
      const end = (s.endedAt?.getTime() ?? now) + SLACK_MS;
      if (t < start || t > end) continue;
      if (!best || Math.abs(t - s.startedAt.getTime()) < Math.abs(t - best.startedAt.getTime())) {
        best = s;
      }
    }
    if (!best) continue;
    const list = result.get(best.id) ?? [];
    list.push(point);
    result.set(best.id, list);
  }
  return result;
}
