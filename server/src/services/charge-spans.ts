/** When the vehicle was plugged in, and which of that time it spent charging. */
import type { Db } from '../db/client.js';
import { changesBetween, latestChanges } from './state-history.js';

export interface ChargerStatusChange {
  ts: Date;
  /** Rivian's chargerStatus, e.g. chrgr_sts_connected_charging. */
  status: string;
}

export interface ChargeSpan {
  kind: 'charging' | 'plugged';
  from: Date;
  to: Date;
}

function kindOf(status: string): ChargeSpan['kind'] | null {
  if (status === 'chrgr_sts_connected_charging') return 'charging';
  if (status.startsWith('chrgr_sts_connected')) return 'plugged';
  return null;
}

/**
 * Spans within [from, to] from status changes in time order. Each status
 * holds until the next change; the last one holds until `to`. A change
 * before `from` sets the state the window opens with.
 */
export function chargeSpans(
  changes: readonly ChargerStatusChange[],
  from: Date,
  to: Date,
): ChargeSpan[] {
  const spans: ChargeSpan[] = [];
  for (let i = 0; i < changes.length; i++) {
    const kind = kindOf(changes[i]!.status);
    if (!kind) continue;
    const start = Math.max(changes[i]!.ts.getTime(), from.getTime());
    const end = Math.min(changes[i + 1]?.ts.getTime() ?? to.getTime(), to.getTime());
    if (end <= start) continue;
    const prev = spans[spans.length - 1];
    if (prev && prev.kind === kind && prev.to.getTime() === start) prev.to = new Date(end);
    else spans.push({ kind, from: new Date(start), to: new Date(end) });
  }
  return spans;
}

/**
 * Charge spans for a vehicle over [from, to], from recorded charger status:
 * its changes, plus the last one before the window so it opens in the
 * right state.
 */
export async function loadChargeSpans(
  db: Db,
  vehicleId: string,
  from: Date,
  to: Date,
): Promise<ChargeSpan[]> {
  const [opening, changes] = await Promise.all([
    latestChanges(db, vehicleId, ['chargerStatus'], from),
    changesBetween(db, vehicleId, ['chargerStatus'], from, to),
  ]);
  return chargeSpans(
    [...opening, ...changes].flatMap((c) =>
      typeof c.value === 'string' ? [{ ts: new Date(c.at), status: c.value }] : [],
    ),
    from,
    new Date(Math.min(to.getTime(), Date.now())),
  );
}

/**
 * When a plug-in actually charged: from the first charging moment within
 * [startedAt, endedAt] to the last. Null if no charging was recorded in it.
 */
export function chargingWindow(
  spans: readonly ChargeSpan[],
  startedAt: Date,
  endedAt: Date | null,
): { from: Date; to: Date } | null {
  const start = startedAt.getTime();
  const end = endedAt?.getTime() ?? Infinity;
  let from: number | null = null;
  let to: number | null = null;
  for (const s of spans) {
    if (s.kind !== 'charging' || s.to.getTime() <= start || s.from.getTime() >= end) continue;
    from ??= Math.max(s.from.getTime(), start);
    to = Math.min(s.to.getTime(), end);
  }
  return from != null && to != null ? { from: new Date(from), to: new Date(to) } : null;
}
