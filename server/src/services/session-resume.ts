/** A session left open by a previous run (e.g. the app restarted mid-charge). */
export interface ResumableSession {
  id: number;
  startedAt: Date;
  /** Newest recorded curve sample, if any. */
  lastSampleAt: Date | null;
  chargingSeconds: number | null;
  /** Start of the charging stretch that was running, if any. */
  chargingSince: Date | null;
}

/**
 * When a session that wasn't continued actually ended, as far as we know:
 * its latest recorded activity. Rivian's history corrects it later.
 */
export function closeTime(open: ResumableSession): Date {
  const times = [open.startedAt, open.lastSampleAt, open.chargingSince]
    .filter((d): d is Date => d != null)
    .map((d) => d.getTime());
  return new Date(Math.max(...times));
}
