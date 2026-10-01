/** Pure calculations for drive summaries. */
import { haversineKm } from "./state-utils.js";

/**
 * Elevation gain/loss with hysteresis: GPS altitude jitters by a few metres,
 * so only count a climb or descent once it moves past `thresholdM` from the
 * last counted point. Summing raw deltas would inflate both numbers.
 */
export function elevationChange(
  altitudes: readonly number[],
  thresholdM = 3,
): { gainM: number; lossM: number } | null {
  const values = altitudes.filter((a) => Number.isFinite(a));
  if (values.length < 2) return null;
  let gainM = 0;
  let lossM = 0;
  let reference = values[0]!;
  for (const altitude of values.slice(1)) {
    const delta = altitude - reference;
    if (delta >= thresholdM) {
      gainM += delta;
      reference = altitude;
    } else if (delta <= -thresholdM) {
      lossM -= delta;
      reference = altitude;
    }
  }
  return { gainM, lossM };
}

/**
 * Energy used from the battery-percentage drop and the pack capacity Rivian
 * reports. Null when the drop isn't positive (e.g. the car was charging) or
 * an input is missing.
 */
export function driveEnergyKwh(
  startBattery: number | null,
  endBattery: number | null,
  capacityKwh: number | null,
): number | null {
  if (startBattery == null || endBattery == null || capacityKwh == null) return null;
  if (!(capacityKwh > 0)) return null;
  const dropPct = startBattery - endBattery;
  if (!(dropPct > 0)) return null;
  return (dropPct / 100) * capacityKwh;
}

/** A stretch this long without a reading, across this much ground, was missed. */
const GAP_MIN_MS = 2 * 60_000;
const GAP_MIN_KM = 0.5;

/**
 * Stretches of a drive with no readings, e.g. while RivianMate was offline.
 * Points are only written when the vehicle moves, so a long wait in
 * traffic leaves no points but also no ground covered; only a jump in
 * position counts.
 */
export function driveGaps(
  points: readonly { ts: number; lat: number; lon: number }[],
): { from: number; to: number }[] {
  const gaps: { from: number; to: number }[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (b.ts - a.ts >= GAP_MIN_MS && haversineKm(a.lat, a.lon, b.lat, b.lon) >= GAP_MIN_KM) {
      gaps.push({ from: a.ts, to: b.ts });
    }
  }
  return gaps;
}

