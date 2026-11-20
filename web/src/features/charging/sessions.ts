import type { ChargingSessionDto } from '../../api/client';
import {
  chargingSecondsNow,
  formatMoney,
  sessionCost,
  sessionTotals,
  socRange,
} from '../../lib/charging';
import { fmt, fmtDuration, fmtSeconds } from '../../lib/state';

/** When a session started charging; the plug-in time when that wasn't recorded. */
export const chargeStart = (s: ChargingSessionDto) => s.chargingStartedAt ?? s.startedAt;
/**
 * Whether the session began at a plug-in well before it charged: only those
 * recorded before sessions began at the charge, so worth naming the plug-in.
 */
export const pluggedInFirst = (s: ChargingSessionDto) =>
  s.chargingStartedAt != null &&
  Date.parse(s.chargingStartedAt) - Date.parse(s.startedAt) >= 60_000;
/** When it stopped charging, else when it was unplugged. */
export const chargeEnd = (s: ChargingSessionDto) => s.chargingEndedAt ?? s.endedAt;

/** Plugged in but not charging yet, so it has no charging curve to show. */
export const notStarted = (s: ChargingSessionDto) =>
  !s.endedAt && s.chargingStartedAt == null && s.chargingSince == null;

/** "12.4 kWh · ≈ $1.61" */
export function dayTotals(sessions: ChargingSessionDto[]): string {
  const totals = sessionTotals(sessions);
  const currency = sessions.find((s) => s.currency)?.currency ?? null;
  return `${fmt(totals.energyKwh, 1)} kWh${totals.cost != null ? ` · ${totals.estimated ? '≈ ' : ''}${formatMoney(String(totals.cost), currency)}` : ''}`;
}

/** "62.0% → 85.0% · 2h 10m · ≈ $3.20" */
export function sessionFacts(s: ChargingSessionDto): string {
  const cost = sessionCost(s);
  const charging = chargingSecondsNow(s);
  return [
    s.startSoc != null && s.endSoc != null && socRange(s.startSoc, s.endSoc),
    charging != null ? fmtSeconds(charging) : fmtDuration(s.startedAt, s.endedAt),
    cost && `${cost.estimated ? '≈ ' : ''}${formatMoney(String(cost.amount), s.currency)}`,
  ]
    .filter(Boolean)
    .join(' · ');
}
