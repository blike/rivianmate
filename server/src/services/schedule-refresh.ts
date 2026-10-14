import { type ChargingWindow, chargingWindowSchedule } from '../rivian/parallax/index.js';
import type { ChargingSchedule } from '../rivian/types.js';

/** How long after Parallax's last window change to query, so a run of edits is one query. */
const SETTLE_MS = 30_000;
/** How long to wait before asking again while the query doesn't have the window yet. */
const RETRY_MS = 2 * 60_000;
const MAX_RETRIES = 3;

/**
 * Re-queries a vehicle's charging schedules soon after Parallax reports its
 * next charging window changed, rather than at the next periodic refresh.
 * Parallax comes from the vehicle and the query from Rivian's servers, which
 * can lag (mid-edit, the query returned no schedules), so it's asked again
 * a few times until it includes the window. Repeats of the same window
 * (resent on wake and subscribe) and empty ones (a charge starting) are
 * ignored. Parallax sends only the next window, so a change to another day
 * waits for the periodic refresh.
 */
export class ChargingScheduleRefresh {
  private last = new Map<string, string>();
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(
    /** The vehicle's schedules from Rivian; null when they couldn't be fetched. */
    private readonly fetch: (vehicleId: string) => Promise<ChargingSchedule[] | null>,
  ) {}

  noteWindow(vehicleId: string, window: ChargingWindow | null): void {
    if (!window) return;
    const key = JSON.stringify(window);
    if (this.last.get(vehicleId) === key) return;
    this.last.set(vehicleId, key);
    this.schedule(vehicleId, window, SETTLE_MS, 0);
  }

  stop(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.last.clear();
  }

  private schedule(vehicleId: string, window: ChargingWindow, delayMs: number, retries: number) {
    clearTimeout(this.timers.get(vehicleId));
    this.timers.set(
      vehicleId,
      setTimeout(() => void this.run(vehicleId, window, retries), delayMs),
    );
  }

  private async run(vehicleId: string, window: ChargingWindow, retries: number): Promise<void> {
    this.timers.delete(vehicleId);
    const schedules = await this.fetch(vehicleId);
    if (schedules && includesWindow(schedules, window)) return;
    // A newer window arrived during the query and is waiting its turn.
    if (this.timers.has(vehicleId) || retries >= MAX_RETRIES) return;
    this.schedule(vehicleId, window, RETRY_MS, retries + 1);
  }
}

/** Whether an enabled schedule covers the window: same start, length and current, on its day. */
export function includesWindow(schedules: readonly ChargingSchedule[], w: ChargingWindow): boolean {
  const expected = chargingWindowSchedule(w);
  if (!expected) return true;
  const day = expected.weekDays![0]!;
  return schedules.some(
    (s) =>
      s.enabled !== false &&
      s.startTime === expected.startTime &&
      s.duration === expected.duration &&
      (s.amperage == null || expected.amperage == null || s.amperage === expected.amperage) &&
      (s.weekDays?.includes(day) ?? false),
  );
}
