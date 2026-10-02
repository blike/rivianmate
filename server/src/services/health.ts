/** Pure calculations for the Health page. */

export interface DrainSnapshot {
  ts: Date;
  batteryLevel: number | null;
  mileageM: number | null;
  chargerStatus: string | null;
  gear?: string | null;
}

export interface DrainDay {
  /** Day in the requested time zone, YYYY-MM-DD. */
  day: string;
  lossPct: number;
  parkedHours: number;
  /** Loss normalized to a full 24 h parked. */
  pctPerDay: number;
}

const MAX_GAP_MS = 6 * 3600_000;
/** Parked time needed before a day's rate (or the average) means anything. */
const MIN_PARKED_MS = 6 * 3600_000;

/** Same place, unplugged, in park, and close enough together to trust. */
function parkedBetween(prev: DrainSnapshot, cur: DrainSnapshot): boolean {
  const gap = cur.ts.getTime() - prev.ts.getTime();
  if (gap <= 0 || gap > MAX_GAP_MS) return false;
  if (prev.batteryLevel == null || cur.batteryLevel == null) return false;
  if (prev.mileageM == null || cur.mileageM == null) return false;
  if (Math.abs(cur.mileageM - prev.mileageM) > 1) return false;
  for (const s of [prev, cur]) {
    if (s.chargerStatus?.startsWith("chrgr_sts_connected")) return false;
    if (s.gear === "drive" || s.gear === "reverse") return false;
  }
  return true;
}

function dayFormatter(timeZone: string): (d: Date) => string {
  // en-CA formats as YYYY-MM-DD.
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return (d) => f.format(d);
}

/**
 * Battery lost while parked and unplugged. Consecutive parked readings form
 * a stretch, and each stretch counts its net change from first to last
 * reading. Rivian's SoC wobbles by a few tenths when the car wakes, and
 * summing only the drops would count every wobble as drain. A stretch's
 * loss is spread over its days by time. Days with too little parked time
 * are left out, since scaling an hour or two up to 24 h mostly amplifies
 * rounding.
 */
export function phantomDrain(
  snapshots: readonly DrainSnapshot[],
  timeZone = "UTC",
): {
  days: DrainDay[];
  avgPctPerDay: number | null;
} {
  const dayOf = dayFormatter(timeZone);
  const byDay = new Map<string, { loss: number; ms: number }>();
  let stretch: [DrainSnapshot, DrainSnapshot][] = [];

  const flush = () => {
    if (stretch.length === 0) return;
    const first = stretch[0]![0];
    const last = stretch[stretch.length - 1]![1];
    const ms = last.ts.getTime() - first.ts.getTime();
    const loss = Math.max(0, first.batteryLevel! - last.batteryLevel!);
    for (const [a, b] of stretch) {
      const gap = b.ts.getTime() - a.ts.getTime();
      const day = dayOf(a.ts);
      const acc = byDay.get(day) ?? { loss: 0, ms: 0 };
      acc.loss += (loss * gap) / ms;
      acc.ms += gap;
      byDay.set(day, acc);
    }
    stretch = [];
  };

  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1]!;
    const cur = snapshots[i]!;
    if (parkedBetween(prev, cur)) stretch.push([prev, cur]);
    else flush();
  }
  flush();

  let totalLoss = 0;
  let totalMs = 0;
  for (const { loss, ms } of byDay.values()) {
    totalLoss += loss;
    totalMs += ms;
  }
  const days = [...byDay.entries()]
    .filter(([, { ms }]) => ms >= MIN_PARKED_MS)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, { loss, ms }]) => {
      const hours = ms / 3600_000;
      return { day, lossPct: loss, parkedHours: hours, pctPerDay: (loss / hours) * 24 };
    });
  const avgPctPerDay = totalMs >= MIN_PARKED_MS ? (totalLoss / totalMs) * 86_400_000 : null;
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
