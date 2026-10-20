/** Thinning a GPS track without changing its shape. */

const M_PER_DEG = 111_320;

/**
 * Indices of the points to keep so the track stays within `toleranceM` of
 * the original (Douglas–Peucker, on a local flat projection). The first and
 * last points are always kept. Straight stretches collapse to their ends;
 * bends keep their points, so trips along the same road still line up.
 */
export function simplifyTrack(
  points: readonly { lat: number; lon: number }[],
  toleranceM: number,
): number[] {
  const n = points.length;
  if (n <= 2) return points.map((_, i) => i);
  const cos = Math.cos((points[0]!.lat * Math.PI) / 180);
  const x = (i: number) => points[i]!.lon * M_PER_DEG * cos;
  const y = (i: number) => points[i]!.lat * M_PER_DEG;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  // An explicit stack: drives can be thousands of points long.
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const dx = x(b) - x(a);
    const dy = y(b) - y(a);
    const len = Math.hypot(dx, dy);
    let worst = -1;
    let worstDist = toleranceM;
    for (let i = a + 1; i < b; i++) {
      const px = x(i) - x(a);
      const py = y(i) - y(a);
      // Distance to the segment a–b (to point a when a and b coincide).
      const t = len === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / (len * len)));
      const d = Math.hypot(px - t * dx, py - t * dy);
      if (d > worstDist) {
        worst = i;
        worstDist = d;
      }
    }
    if (worst < 0) continue;
    keep[worst] = 1;
    stack.push([a, worst], [worst, b]);
  }
  const kept: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) kept.push(i);
  return kept;
}

/** At most this many points for a window's routes. */
export const MAX_TRACK_POINTS = 20_000;

/**
 * How far a simplified drive may stray from its recorded points: tighter for
 * short windows, viewed up close; looser for long ones, viewed zoomed out.
 */
export function trackToleranceM(from: Date, to: Date): number {
  const days = (to.getTime() - from.getTime()) / 86400_000;
  return days <= 7 ? 5 : days <= 31 ? 10 : 20;
}

/**
 * A window's points, in time order, thinned for drawing its routes. Each
 * drive is simplified rather than every nth point kept, so trips along the
 * same road keep their shape and line up on the map; points outside a drive
 * stay as they are. Still more than `max`, they're thinned evenly, keeping
 * both ends.
 */
export function thinTrack<T extends { lat: number; lon: number }>(
  rows: readonly T[],
  driveOf: (row: T) => number | null,
  toleranceM: number,
  max = MAX_TRACK_POINTS,
): T[] {
  let kept: T[] = [];
  for (let start = 0; start < rows.length;) {
    const drive = driveOf(rows[start]!);
    let end = start + 1;
    while (end < rows.length && driveOf(rows[end]!) === drive) end++;
    const group = rows.slice(start, end);
    if (drive == null) kept.push(...group);
    else for (const i of simplifyTrack(group, toleranceM)) kept.push(group[i]!);
    start = end;
  }
  if (kept.length > max) {
    const step = Math.ceil(kept.length / max);
    kept = kept.filter((_, i) => i % step === 0 || i === kept.length - 1);
  }
  return kept;
}
