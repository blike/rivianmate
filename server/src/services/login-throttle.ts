/** Failed attempts allowed per address in a window before it has to wait. */
const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60_000;

/**
 * Limits password guesses per client address: after too many failures in
 * the window, further attempts are refused until the oldest ages out.
 */
export class LoginThrottle {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxFailures = MAX_FAILURES,
    private readonly windowMs = WINDOW_MS,
  ) {}

  /** Seconds until `key` may try again; 0 when it may now. */
  retryAfter(key: string): number {
    const recent = this.recent(key);
    if (recent.length < this.maxFailures) return 0;
    return Math.ceil((recent[0]! + this.windowMs - this.now()) / 1000);
  }

  fail(key: string): void {
    this.failures.set(key, [...this.recent(key), this.now()]);
  }

  succeed(key: string): void {
    this.failures.delete(key);
  }

  private recent(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const recent = (this.failures.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length) this.failures.set(key, recent);
    else this.failures.delete(key);
    return recent;
  }
}
