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

/** "12.4 kWh · ≈ $1.61" */
export function dayTotals(sessions: ChargingSessionDto[]): string {
  const totals = sessionTotals(sessions);
  const currency = sessions.find((s) => s.currency)?.currency ?? null;
  return `${fmt(totals.energyKwh, 1)} kWh${totals.cost != null ? ` · ${totals.estimated ? '≈ ' : ''}${formatMoney(String(totals.cost), currency)}` : ''}`;
}

/** "62→85% · 2h 10m · ≈ $3.20" */
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
