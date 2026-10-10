import { and, asc, between, eq, gte, isNotNull, isNull, min } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { chargingSessions, vehicleStateSnapshots } from "../db/schema.js";
import type { RivianApi } from "../rivian/client.js";
import { deriveChargingStats } from "./charging-time.js";
import {
  type ChargeSessionSummary,
  RivianUnauthenticatedError,
  type VehicleState,
  describeRivianError,
  isGraphqlValidationError,
} from "../rivian/types.js";

export interface SessionCandidate {
  id: number;
  startedAt: Date;
  endedAt: Date | null;
  rivianTransactionId: string | null;
}

/** Summaries that belong to this vehicle (single-vehicle accounts keep unlabeled ones). */
export function summariesForVehicle(
  summaries: readonly ChargeSessionSummary[],
  vehicleId: string,
  vehicleCount: number,
): ChargeSessionSummary[] {
  return summaries.filter((s) =>
    s.vehicleId ? s.vehicleId === vehicleId : vehicleCount === 1,
  );
}

/**
 * Existing session a Rivian summary describes: same transaction id first,
 * otherwise a live-recorded session (no transaction id yet) whose time span
 * overlaps the summary's. Closest start wins.
 */
export function matchSession(
  summary: ChargeSessionSummary,
  candidates: readonly SessionCandidate[],
): SessionCandidate | null {
  if (summary.transactionId) {
    const byId = candidates.find((c) => c.rivianTransactionId === summary.transactionId);
    if (byId) return byId;
  }
  const start = parseDate(summary.startInstant);
  if (!start) return null;
  const end = parseDate(summary.endInstant) ?? start;
  let best: SessionCandidate | null = null;
  for (const c of candidates) {
    if (c.rivianTransactionId) continue;
    const cEnd = c.endedAt ?? c.startedAt;
    const overlaps = c.startedAt.getTime() <= end.getTime() && cEnd.getTime() >= start.getTime();
    if (!overlaps) continue;
    if (
      !best ||
      Math.abs(c.startedAt.getTime() - start.getTime()) <
        Math.abs(best.startedAt.getTime() - start.getTime())
    ) {
      best = c;
    }
  }
  return best;
}

export function chargerTypeFor(
  summary: ChargeSessionSummary,
): "rivian_charger" | "wallbox" | "other" {
  if (/rivian/i.test(summary.vendor ?? "") && summary.isPublic) return "rivian_charger";
  if (summary.isHomeCharger) return "wallbox";
  return "other";
}

export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const DAILY_MS = 24 * 3600_000;
const AFTER_SESSION_DELAY_MS = 15 * 60_000;
/** Snapshot rows are stamped on write, which can trail the readings inside. */
const SNAPSHOT_MARGIN_MS = 2 * 3600_000;

/**
 * Imports Rivian's completed-session history: backfills sessions charged
 * before RivianMate was running (public charging included, with Rivian's
 * cost and energy) and enriches sessions recorded live. Never overwrites
 * values already present, including a cost the user entered.
 */
export class ChargeHistoryImporter {
  private timer?: NodeJS.Timeout;
  private pending?: NodeJS.Timeout;
  private unsupported = false;
  private running = false;

  onAuthFailure?: () => void;

  constructor(
    private readonly db: Db,
    private readonly api: RivianApi,
    private readonly vehicleIds: () => string[],
    private readonly log: (msg: string) => void = () => {},
  ) {}

  start(): void {
    void this.run();
    this.timer = setInterval(() => void this.run(), DAILY_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.pending) clearTimeout(this.pending);
    this.timer = undefined;
    this.pending = undefined;
  }

  /** Rivian finalizes a session a little after it ends; sync then. */
  scheduleAfterSession(): void {
    if (this.pending) clearTimeout(this.pending);
    this.pending = setTimeout(() => {
      this.pending = undefined;
      void this.run();
    }, AFTER_SESSION_DELAY_MS);
  }

  async run(): Promise<{ inserted: number; linked: number } | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const result = this.unsupported ? null : await this.importHistory();
      await this.fillFromStateHistory();
      return result;
    } finally {
      this.running = false;
    }
  }

  private async importHistory(): Promise<{ inserted: number; linked: number } | null> {
    try {
      const summaries = await this.api.getChargeHistory();
      const ids = this.vehicleIds();
      let inserted = 0;
      let linked = 0;
      for (const vehicleId of ids) {
        const result = await this.importForVehicle(
          vehicleId,
          summariesForVehicle(summaries, vehicleId, ids.length),
        );
        inserted += result.inserted;
        linked += result.linked;
      }
      if (inserted || linked) {
        this.log(`charge history: ${inserted} imported, ${linked} linked`);
      }
      return { inserted, linked };
    } catch (err) {
      if (isGraphqlValidationError(err)) {
        this.unsupported = true;
        this.log(`charge history query not supported: ${describeRivianError(err)}`);
      } else if (err instanceof RivianUnauthenticatedError) {
        this.onAuthFailure?.();
      } else {
        this.log(`charge history sync failed: ${describeRivianError(err)}`);
      }
      return null;
    }
  }

  /**
   * Charging time and SOC for finished sessions that lack them (typically
   * imported from Rivian), rebuilt from the vehicle states RivianMate
   * recorded during the session. Sessions from before recording began are
   * skipped.
   */
  private async fillFromStateHistory(): Promise<void> {
    try {
      for (const vehicleId of this.vehicleIds()) {
        const [first] = await this.db
          .select({ ts: min(vehicleStateSnapshots.ts) })
          .from(vehicleStateSnapshots)
          .where(eq(vehicleStateSnapshots.vehicleId, vehicleId));
        if (!first?.ts) continue;
        const sessions = await this.db
          .select()
          .from(chargingSessions)
          .where(
            and(
              eq(chargingSessions.vehicleId, vehicleId),
              isNull(chargingSessions.chargingSeconds),
              isNotNull(chargingSessions.endedAt),
              gte(chargingSessions.endedAt, first.ts),
            ),
          );
        let filled = 0;
        for (const session of sessions) {
          const start = session.startedAt.getTime();
          const end = session.endedAt!.getTime();
          const rows = await this.db
            .select({ data: vehicleStateSnapshots.data })
            .from(vehicleStateSnapshots)
            .where(
              and(
                eq(vehicleStateSnapshots.vehicleId, vehicleId),
                between(
                  vehicleStateSnapshots.ts,
                  new Date(start - SNAPSHOT_MARGIN_MS),
                  new Date(end + SNAPSHOT_MARGIN_MS),
                ),
              ),
            )
            .orderBy(asc(vehicleStateSnapshots.ts))
            .limit(5000);
          const stats = deriveChargingStats(
            rows.map((r) => r.data as VehicleState),
            start,
            end,
          );
          if (stats.chargingSeconds === null) continue;
          await this.db
            .update(chargingSessions)
            .set({
              chargingSeconds: stats.chargingSeconds,
              startSoc: session.startSoc ?? stats.startSoc,
              endSoc: session.endSoc ?? stats.endSoc,
            })
            .where(eq(chargingSessions.id, session.id));
          filled += 1;
        }
        if (filled) this.log(`charge history: filled charging time for ${filled} sessions`);
      }
    } catch (err) {
      this.log(`charging time backfill failed: ${(err as Error).message}`);
    }
  }

  private async importForVehicle(
    vehicleId: string,
    summaries: ChargeSessionSummary[],
  ): Promise<{ inserted: number; linked: number }> {
    const existing = await this.db
      .select()
      .from(chargingSessions)
      .where(eq(chargingSessions.vehicleId, vehicleId));
    const candidates: SessionCandidate[] = existing.map((r) => ({
      id: r.id,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      rivianTransactionId: r.rivianTransactionId,
    }));
    const rowsById = new Map(existing.map((r) => [r.id, r]));
    let inserted = 0;
    let linked = 0;

    for (const s of summaries) {
      const startedAt = parseDate(s.startInstant);
      if (!startedAt) continue;
      const endedAt = parseDate(s.endInstant);
      const cost = s.paidTotal != null ? s.paidTotal.toFixed(2) : null;
      const match = matchSession(s, candidates);

      if (match) {
        const row = rowsById.get(match.id)!;
        const alreadyLinked = row.rivianTransactionId === (s.transactionId ?? null);
        await this.db
          .update(chargingSessions)
          .set({
            rivianTransactionId: row.rivianTransactionId ?? s.transactionId ?? null,
            source: row.source === "rivian" ? "rivian" : "live+rivian",
            vendor: row.vendor ?? s.vendor ?? null,
            city: row.city ?? s.city ?? null,
            isPublic: row.isPublic ?? s.isPublic ?? null,
            isHomeCharger: row.isHomeCharger ?? s.isHomeCharger ?? null,
            energyKwh: row.energyKwh ?? s.totalEnergyKwh ?? null,
            rangeAddedKm: row.rangeAddedKm ?? s.rangeAddedKm ?? null,
            // Rivian's span runs from plug-in to unplug, which we may have
            // only partly seen (e.g. started while already plugged in).
            startedAt: startedAt < row.startedAt ? startedAt : row.startedAt,
            endedAt: endedAt ?? row.endedAt,
            // Rivian's billed total is final, so it replaces running totals
            // recorded while charging; a cost the owner entered stays.
            ...(!row.costEdited && cost != null
              ? { cost, currency: s.currencyCode ?? row.currency ?? null }
              : { currency: row.currency ?? s.currencyCode ?? null }),
          })
          .where(eq(chargingSessions.id, match.id));
        match.rivianTransactionId = match.rivianTransactionId ?? s.transactionId ?? null;
        if (!alreadyLinked) linked += 1;
        continue;
      }

      const [created] = await this.db
        .insert(chargingSessions)
        .values({
          vehicleId,
          startedAt,
          endedAt: endedAt ?? startedAt,
          source: "rivian",
          rivianTransactionId: s.transactionId ?? null,
          chargerType: chargerTypeFor(s),
          isRivianCharger: /rivian/i.test(s.vendor ?? "") && s.isPublic === true,
          vendor: s.vendor ?? null,
          city: s.city ?? null,
          isPublic: s.isPublic ?? null,
          isHomeCharger: s.isHomeCharger ?? null,
          energyKwh: s.totalEnergyKwh ?? null,
          rangeAddedKm: s.rangeAddedKm ?? null,
          cost,
          currency: s.currencyCode ?? null,
        })
        .returning();
      candidates.push({
        id: created!.id,
        startedAt,
        endedAt: created!.endedAt,
        rivianTransactionId: created!.rivianTransactionId,
      });
      rowsById.set(created!.id, created!);
      inserted += 1;
    }
    return { inserted, linked };
  }
}
