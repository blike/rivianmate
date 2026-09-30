/**
 * Process-wide traffic governor for everything this app sends to Rivian.
 *
 * The Rivian cloud is shared with the official phone app: if this account
 * floods it (or keeps hammering after being rate limited) the phone app is
 * the one that ends up losing its vehicle connection. Every HTTP request and
 * every WebSocket (re)connect goes through one governor so that:
 *
 * - requests are serialized and spaced out (no bursts),
 * - a rate-limit response pauses *all* traffic for a cooldown that grows on
 *   repeated rate limits (and honors Retry-After when Rivian sends one);
 *   calls made during a cooldown fail fast instead of queueing up,
 * - counters are kept so the Settings page can show exactly how much traffic
 *   this installation generates.
 */

import { RivianCooldownError } from "./types.js";

const DEFAULT_MIN_SPACING_MS = 2_000;
const RATE_LIMIT_BASE_COOLDOWN_MS = 5 * 60_000;
const RATE_LIMIT_MAX_COOLDOWN_MS = 60 * 60_000;
const HOUR_MS = 60 * 60_000;
const WINDOW_HOURS = 24;

export type RivianTrafficCounter =
  | "httpRequests"
  | "httpErrors"
  | "rateLimited"
  | "sessionRefreshes"
  | "wsConnects"
  | "wsReconnects"
  | "wsMessages"
  | "wsAuthFailures";

export interface RivianTrafficSnapshot {
  since: string;
  last24h: Record<RivianTrafficCounter, number>;
  requestsByOperation24h: Record<string, number>;
  cooldownUntil: string | null;
  lastRateLimitedAt: string | null;
}

interface HourBucket {
  hour: number;
  counters: Partial<Record<RivianTrafficCounter, number>>;
  operations: Record<string, number>;
}

export interface GovernorOptions {
  minSpacingMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class RivianGovernor {
  private readonly minSpacingMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly startedAt: number;

  private queue: Promise<void> = Promise.resolve();
  private lastRequestAt = 0;
  private cooldownUntil = 0;
  private consecutiveRateLimits = 0;
  private lastRateLimitedAt: number | null = null;
  private buckets: HourBucket[] = [];

  constructor(options: GovernorOptions = {}) {
    this.minSpacingMs = options.minSpacingMs ?? DEFAULT_MIN_SPACING_MS;
    this.now = options.now ?? Date.now;
    this.sleep =
      options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.startedAt = this.now();
  }

  /**
   * Runs `fn` once it is this caller's turn, at least `minSpacingMs` after the
   * previous request started. Rejects with RivianCooldownError while a
   * rate-limit cooldown is active.
   */
  async schedule<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    this.assertNotCoolingDown(operation);
    const turn = this.queue.then(() => this.waitForSlot());
    // Keep the chain alive regardless of this call's outcome.
    this.queue = turn.catch(() => {});
    await turn;
    this.count("httpRequests");
    this.countOperation(operation);
    return fn();
  }

  /** Milliseconds until traffic may resume (0 when not cooling down). */
  cooldownRemainingMs(): number {
    return Math.max(0, this.cooldownUntil - this.now());
  }

  /** Waits out an active rate-limit cooldown (used before WebSocket connects). */
  async waitForCooldown(): Promise<void> {
    const remaining = this.cooldownRemainingMs();
    if (remaining > 0) await this.sleep(remaining);
  }

  /** Records a rate-limit response and pauses all traffic. */
  noteRateLimited(retryAfterMs?: number): number {
    this.consecutiveRateLimits += 1;
    this.lastRateLimitedAt = this.now();
    this.count("rateLimited");
    const backoff = Math.min(
      RATE_LIMIT_BASE_COOLDOWN_MS * 2 ** (this.consecutiveRateLimits - 1),
      RATE_LIMIT_MAX_COOLDOWN_MS,
    );
    const cooldown = Math.max(backoff, retryAfterMs ?? 0);
    this.cooldownUntil = Math.max(this.cooldownUntil, this.now() + cooldown);
    return cooldown;
  }

  /** A successful response ends the rate-limit escalation. */
  noteSuccess(): void {
    this.consecutiveRateLimits = 0;
  }

  count(counter: RivianTrafficCounter, by = 1): void {
    const bucket = this.currentBucket();
    bucket.counters[counter] = (bucket.counters[counter] ?? 0) + by;
  }

  snapshot(): RivianTrafficSnapshot {
    this.prune();
    const last24h: Record<RivianTrafficCounter, number> = {
      httpRequests: 0,
      httpErrors: 0,
      rateLimited: 0,
      sessionRefreshes: 0,
      wsConnects: 0,
      wsReconnects: 0,
      wsMessages: 0,
      wsAuthFailures: 0,
    };
    const requestsByOperation24h: Record<string, number> = {};
    for (const bucket of this.buckets) {
      for (const [key, value] of Object.entries(bucket.counters)) {
        last24h[key as RivianTrafficCounter] += value ?? 0;
      }
      for (const [op, value] of Object.entries(bucket.operations)) {
        requestsByOperation24h[op] = (requestsByOperation24h[op] ?? 0) + value;
      }
    }
    return {
      since: new Date(this.startedAt).toISOString(),
      last24h,
      requestsByOperation24h,
      cooldownUntil:
        this.cooldownUntil > this.now()
          ? new Date(this.cooldownUntil).toISOString()
          : null,
      lastRateLimitedAt:
        this.lastRateLimitedAt != null
          ? new Date(this.lastRateLimitedAt).toISOString()
          : null,
    };
  }

  private assertNotCoolingDown(operation: string): void {
    const remaining = this.cooldownRemainingMs();
    if (remaining <= 0) return;
    const err = new RivianCooldownError(
      `Skipping ${operation}: Rivian traffic paused for ${Math.ceil(remaining / 1000)}s after a rate limit`,
      "RATE_LIMIT",
    );
    err.retryAfterMs = remaining;
    throw err;
  }

  private async waitForSlot(): Promise<void> {
    for (;;) {
      const now = this.now();
      // A rate limit may have landed while this caller was queued.
      this.assertNotCoolingDown("queued request");
      const wait = this.lastRequestAt + this.minSpacingMs - now;
      if (wait <= 0) {
        this.lastRequestAt = now;
        return;
      }
      await this.sleep(wait);
    }
  }

  private countOperation(operation: string): void {
    const bucket = this.currentBucket();
    bucket.operations[operation] = (bucket.operations[operation] ?? 0) + 1;
  }

  private currentBucket(): HourBucket {
    const hour = Math.floor(this.now() / HOUR_MS);
    const last = this.buckets[this.buckets.length - 1];
    if (last && last.hour === hour) return last;
    const bucket: HourBucket = { hour, counters: {}, operations: {} };
    this.buckets.push(bucket);
    this.prune();
    return bucket;
  }

  private prune(): void {
    const oldest = Math.floor(this.now() / HOUR_MS) - (WINDOW_HOURS - 1);
    this.buckets = this.buckets.filter((b) => b.hour >= oldest);
  }
}

/** Parses a Retry-After header (seconds or HTTP date) into milliseconds. */
export function parseRetryAfter(
  header: string | null | undefined,
  now = Date.now(),
): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}
