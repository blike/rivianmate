/**
 * Centered moving average over time: each value becomes the mean of the
 * readings within `windowMinutes` around it. Gaps stay gaps (a missing
 * value isn't filled in), and with too few points it returns them as is.
 */
export function smoothByTime(
  xs: readonly number[],
  values: readonly (number | null)[],
  windowMinutes: number,
): (number | null)[] {
  const half = windowMinutes / 2;
  if (!(half > 0) || values.length < 3) return [...values];
  return values.map((v, i) => {
    if (v == null) return null;
    let sum = 0;
    let count = 0;
    for (let j = i; j >= 0 && xs[i]! - xs[j]! <= half; j--) {
      const w = values[j];
      if (w != null) {
        sum += w;
        count++;
      }
    }
    for (let j = i + 1; j < values.length && xs[j]! - xs[i]! <= half; j++) {
      const w = values[j];
      if (w != null) {
        sum += w;
        count++;
      }
    }
    return sum / count;
  });
}

/**
 * A smoothing window that scales with the chart: about 1/20 of its span,
 * at least a minute, so a 30-minute fast charge and an 8-hour home charge
 * are both smoothed without flattening their shape.
 */
export function smoothingWindowMinutes(spanMinutes: number): number {
  return Math.max(1, spanMinutes / 20);
}
