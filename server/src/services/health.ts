/** Pure calculations for the Health page. */

export interface DrainSnapshot {
  ts: Date;
  batteryLevel: number | null;
  mileageM: number | null;
  chargerStatus: string | null;
}

export interface DrainDay {
  /** UTC day, YYYY-MM-DD. */
  day: string;
  lossPct: number;
  parkedHours: number;
  /** Loss normalized to a full 24 h parked. */
  pctPerDay: number;
}

const MAX_GAP_MS = 6 * 3600_000;
const CHARGING = "chrgr_sts_connected_charging";

/**
 * Battery lost while parked. A pair of consecutive snapshots counts only if
 * the odometer did not move, the car was not charging, the battery did not
 * rise, and the gap is short enough to trust (no long blind spots).
 */
export function phantomDrain(snapshots: readonly DrainSnapshot[]): {
  days: DrainDay[];
  avgPctPerDay: number | null;
} {
  const byDay = new Map<string, { loss: number; ms: number }>();
  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1]!;
    const cur = snapshots[i]!;
    const gap = cur.ts.getTime() - prev.ts.getTime();
    if (gap <= 0 || gap > MAX_GAP_MS) continue;
    if (prev.batteryLevel == null || cur.batteryLevel == null) continue;
    if (prev.mileageM == null || cur.mileageM == null) continue;
    if (Math.abs(cur.mileageM - prev.mileageM) > 1) continue;
    if (prev.chargerStatus === CHARGING || cur.chargerStatus === CHARGING) continue;
    const loss = prev.batteryLevel - cur.batteryLevel;
    if (loss < 0) continue;
    const day = prev.ts.toISOString().slice(0, 10);
    const acc = byDay.get(day) ?? { loss: 0, ms: 0 };
    acc.loss += loss;
    acc.ms += gap;
    byDay.set(day, acc);
  }
  let totalLoss = 0;
  let totalMs = 0;
  const days = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, { loss, ms }]) => {
      totalLoss += loss;
      totalMs += ms;
      const hours = ms / 3600_000;
      return { day, lossPct: loss, parkedHours: hours, pctPerDay: (loss / hours) * 24 };
    });
  // Need a few hours of parked data before an average means anything.
  const avgPctPerDay = totalMs >= 6 * 3600_000 ? (totalLoss / totalMs) * 86_400_000 : null;
  return { days, avgPctPerDay };
}

export interface CapacitySession {
  id: number;
  startedAt: Date;
  startSoc: number | null;
  endSoc: number | null;
  energyKwh: number | null;
}

/** Sessions must add at least this much SoC for a usable estimate. */
export const MIN_SOC_GAIN = 20;

/**
 * Usable-capacity estimate per charging session: energy added divided by
 * the SoC gained. Small sessions are too noisy and are skipped.
 */
export function capacityEstimates(sessions: readonly CapacitySession[]) {
  return sessions
    .filter(
      (s) =>
        s.startSoc != null &&
        s.endSoc != null &&
        s.energyKwh != null &&
        s.energyKwh > 0 &&
        s.endSoc - s.startSoc >= MIN_SOC_GAIN,
    )
    .map((s) => ({
      sessionId: s.id,
      date: s.startedAt.toISOString(),
      socGain: s.endSoc! - s.startSoc!,
      estimatedKwh: s.energyKwh! / ((s.endSoc! - s.startSoc!) / 100),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
