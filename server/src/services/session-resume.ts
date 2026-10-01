import type { LiveSessionData } from "../rivian/types.js";

/** A session left open by a previous run (e.g. the app restarted mid-charge). */
export interface ResumableSession {
  id: number;
  startedAt: Date;
  /** Newest recorded curve sample, if any. */
  lastSampleAt: Date | null;
}

/** Rivian's start time vs. ours can differ a little (we may start on first sample). */
const START_TOLERANCE_MS = 10 * 60_000;
/** Without a start time, only a recent sample proves it's the same charge. */
const RECENT_SAMPLE_MS = 30 * 60_000;

/**
 * Whether live charging data describes the session left open by the
 * previous run, so it can be continued instead of split in two.
 */
export function isSameSession(
  open: ResumableSession,
  live: LiveSessionData,
  now: number,
): boolean {
  const liveStart = live.startTime ? Date.parse(live.startTime) : Number.NaN;
  if (Number.isFinite(liveStart)) {
    return Math.abs(liveStart - open.startedAt.getTime()) <= START_TOLERANCE_MS;
  }
  return open.lastSampleAt != null && now - open.lastSampleAt.getTime() <= RECENT_SAMPLE_MS;
}

/** When a session that wasn't resumed actually ended: its last sample, else its start. */
export function closeTime(open: ResumableSession): Date {
  return open.lastSampleAt ?? open.startedAt;
}
