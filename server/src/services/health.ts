/** Pure calculations for the Health page. */

export interface DrainSnapshot {
  ts: Date;
  batteryLevel: number | null;
  mileageM: number | null;
  chargerStatus: string | null;
  gear?: string | null;
}

/** One recorded moment of the fields drain reads: each value, and when it was stamped. */
export interface DrainReading {
  at: number;
  batteryLevel: { value: number; at: number } | null;
  mileage: { value: number; at: number } | null;
  chargerStatus: string | null;
  gear: string | null;
}

/**
 * A battery level stamped before the latest mileage change, when the
 * level's next change follows within this, is from before the movement:
 * Rivian delivers a late drive's mileage and level stamped minutes apart.
 */
const SETTLE_MS = 30 * 60_000;

/**
 * Drain snapshots from recorded moments. A moment whose battery level is
 * from before the latest movement, with the level after it still to come,
 * has no usable level, so a drive delivered late isn't counted as drain.
 */
export function drainSnapshots(readings: readonly DrainReading[]): DrainSnapshot[] {
  const levelChanges = [...new Set(readings.flatMap((r) => r.batteryLevel?.at ?? []))].sort(
    (a, b) => a - b,
  );
  return readings.map((r) => {
    let batteryLevel = r.batteryLevel?.value ?? null;
    if (r.batteryLevel && r.mileage && r.batteryLevel.at < r.mileage.at) {
      const next = levelChanges.find((t) => t > r.mileage!.at);
      if (next !== undefined && next - r.mileage.at <= SETTLE_MS) batteryLevel = null;
    }
    return {
      ts: new Date(r.at),
      batteryLevel,
      mileageM: r.mileage?.value ?? null,
      chargerStatus: r.chargerStatus,
      gear: r.gear,
    };
  });
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

/** Same place, unplugged, in park, and no further apart than `maxGapMs`. */
function parkedBetween(prev: DrainSnapshot, cur: DrainSnapshot, maxGapMs: number): boolean {
  const gap = cur.ts.getTime() - prev.ts.getTime();
  if (gap <= 0 || gap > maxGapMs) return false;
  if (prev.batteryLevel == null || cur.batteryLevel == null) return false;
  if (prev.mileageM == null || cur.mileageM == null) return false;
  if (Math.abs(cur.mileageM - prev.mileageM) > 1) return false;
  for (const s of [prev, cur]) {
    if (s.chargerStatus?.startsWith('chrgr_sts_connected')) return false;
    if (s.gear === 'drive' || s.gear === 'reverse') return false;
  }
  return true;
}

function dayFormatter(timeZone: string): (d: Date) => string {
  // en-CA formats as YYYY-MM-DD.
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return (d) => f.format(d);
}

interface ParkedStretch {
  pairs: [DrainSnapshot, DrainSnapshot][];
  /** Net battery lost across the stretch, in percent. */
  loss: number;
  ms: number;
}

/**
 * Stretches parked and unplugged: consecutive parked readings, each
 * counting its net change from first to last reading. Rivian's SoC wobbles
 * by a few tenths when the car wakes, and summing only the drops would
 * count every wobble as drain.
 */
function parkedStretches(
  snapshots: readonly DrainSnapshot[],
  maxGapMs = MAX_GAP_MS,
): ParkedStretch[] {
  const stretches: ParkedStretch[] = [];
  let pairs: [DrainSnapshot, DrainSnapshot][] = [];
  const flush = () => {
    if (pairs.length === 0) return;
    const first = pairs[0]![0];
    const last = pairs[pairs.length - 1]![1];
    stretches.push({
      pairs,
      loss: Math.max(0, first.batteryLevel! - last.batteryLevel!),
      ms: last.ts.getTime() - first.ts.getTime(),
    });
    pairs = [];
  };
  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1]!;
    const cur = snapshots[i]!;
    if (parkedBetween(prev, cur, maxGapMs)) pairs.push([prev, cur]);
    else flush();
  }
  flush();
  return stretches;
}

/**
 * Battery lost while parked and unplugged, by day. A stretch's loss is
 * spread over its days by time. Days with too little parked time are left
 * out, since scaling an hour or two up to 24 h mostly amplifies rounding.
 */
export function phantomDrain(
  snapshots: readonly DrainSnapshot[],
  timeZone = 'UTC',
): {
  days: DrainDay[];
  avgPctPerDay: number | null;
} {
  const dayOf = dayFormatter(timeZone);
  const byDay = new Map<string, { loss: number; ms: number }>();
  for (const { pairs, loss, ms } of parkedStretches(snapshots)) {
    for (const [a, b] of pairs) {
      const gap = b.ts.getTime() - a.ts.getTime();
      const day = dayOf(a.ts);
      const acc = byDay.get(day) ?? { loss: 0, ms: 0 };
      acc.loss += (loss * gap) / ms;
      acc.ms += gap;
      byDay.set(day, acc);
    }
  }

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

/** A drive or a plug-in: time the vehicle wasn't parked and unplugged. */
export interface BusySpan {
  start: Date;
  end: Date | null;
  /** Battery level as the span began and ended, where recorded. */
  startLevel: number | null;
  endLevel: number | null;
}

/**
 * Battery lost while parked and unplugged over [from, to], and the time
 * parked. Each parked stretch runs from where the drive or charge before it
 * left off to where the next one picked up, so loss is measured from those
 * levels rather than the readings in between: the reported level dips while
 * the vehicle sits and recovers when it wakes, and the dip isn't energy used.
 * This matches Rivian's parked energy, which counts from the moment of
 * parking. `levelAt` fills in for spans without a recorded level, and gives
 * the level at the period's edges.
 */
export function parkedLoss(
  spans: readonly BusySpan[],
  from: Date,
  to: Date,
  levelAt: (at: Date) => number | null,
): { lossPct: number; parkedHours: number } {
  let lossPct = 0;
  let ms = 0;
  let at = from.getTime();
  let level = levelAt(from);
  const park = (until: number, nextLevel: number | null) => {
    if (until <= at) return;
    ms += until - at;
    if (level != null && nextLevel != null) lossPct += level - nextLevel;
  };
  const sorted = [...spans].sort((a, b) => a.start.getTime() - b.start.getTime());
  for (const span of sorted) {
    const start = span.start.getTime();
    const end = Math.min(span.end?.getTime() ?? to.getTime(), to.getTime());
    if (end <= at || start >= to.getTime()) continue;
    park(start, span.startLevel ?? levelAt(span.start));
    at = end;
    level = (end === span.end?.getTime() ? span.endLevel : null) ?? levelAt(new Date(end));
  }
  park(to.getTime(), levelAt(to));
  // Rounding in the levels can tip a short stretch either way; the total can't gain.
  return { lossPct: Math.max(0, lossPct), parkedHours: ms / 3600_000 };
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
