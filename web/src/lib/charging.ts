import type { ChargingSessionDto } from '@server/api-types';
import { fmt, titleCase } from './state';

/**
 * Seconds spent charging so far, counting a stretch still running; null
 * when RivianMate didn't watch the session.
 */
export function chargingSecondsNow(
  s: Pick<ChargingSessionDto, 'chargingSeconds' | 'chargingSince'>,
  now = Date.now(),
): number | null {
  if (s.chargingSeconds == null && s.chargingSince == null) return null;
  const running = s.chargingSince ? Math.max(0, now - Date.parse(s.chargingSince)) / 1000 : 0;
  return (s.chargingSeconds ?? 0) + running;
}

/** "39.7% → 70.0%", with "?" for an unknown end, or "—" when both are unknown. */
export function socRange(start: number | null, end: number | null): string {
  if (start == null && end == null) return '—';
  const part = (v: number | null) => (v == null ? '?' : `${fmt(v, 1)}%`);
  return `${part(start)} → ${part(end)}`;
}

const moneyPrefix = (currency: string | null) =>
  currency === 'USD' || !currency ? '$' : `${currency} `;

export function formatMoney(amount: string, currency: string | null): string {
  return `${moneyPrefix(currency)}${fmt(Number(amount), 2)}`;
}

/** "$0.131/kWh", "Free", or "No rate"; rates keep up to three decimals. */
export function rateLabel(rate: number | null, currency: string): string {
  if (rate == null) return 'No rate';
  if (rate === 0) return 'Free';
  return `${moneyPrefix(currency)}${Number(rate.toFixed(3))}/kWh`;
}

export function chargerLabel(
  s: Pick<ChargingSessionDto, 'chargerType' | 'isHome' | 'vendor' | 'chargerId' | 'location'> & {
    city?: string | null;
  },
): string {
  // A saved location's name says where better than the network did.
  if (s.location) return s.location.name;
  // One name for Rivian's own chargers, however the session recorded it.
  if (s.chargerType === 'rivian_charger' || /^rivian\b/i.test(s.vendor ?? '')) return 'Rivian';
  if (s.isHome) return 'Home';
  if (s.vendor) return titleCase(s.vendor.toLowerCase());
  if (s.chargerId) return s.chargerId;
  // Nothing about the charger (an imported charge): where it was will do.
  if (!s.chargerType && s.city) return s.city;
  return titleCase(s.chargerType);
}

/** The city to show beside a session's label, unless it's home, saved, or the label itself. */
export function sessionCity(
  s: Pick<
    ChargingSessionDto,
    'chargerType' | 'isHome' | 'vendor' | 'chargerId' | 'location' | 'city'
  >,
): string | null {
  if (!s.city || s.isHome || s.location || chargerLabel(s) === s.city) return null;
  return s.city;
}

/**
 * Where a charge in progress is headed. Rivian's time remaining runs to the
 * end of the session, which a charging schedule can cut short of the limit;
 * the SoC it will reach by then is estimated from power and pack size.
 * "session" when it stops more than a point short of the limit.
 */
export function chargeOutlook(i: {
  soc: number | null;
  limit: number | null;
  powerKw: number | null;
  capacityKwh: number | null;
  minutesLeft: number | null;
}): { kind: 'limit' | 'session'; minutes: number | null; endSoc: number | null } {
  const { soc, limit, powerKw, capacityKwh, minutesLeft } = i;
  // Percent per minute, ignoring charging losses (a slight overestimate).
  const rate = powerKw && capacityKwh ? ((powerKw / capacityKwh) * 100) / 60 : null;
  if (minutesLeft != null && rate != null && soc != null && limit != null) {
    const endSoc = Math.min(limit, soc + rate * minutesLeft);
    if (endSoc < limit - 1) return { kind: 'session', minutes: minutesLeft, endSoc };
  }
  const toLimit =
    rate != null && soc != null && limit != null && soc < limit ? (limit - soc) / rate : null;
  return { kind: 'limit', minutes: minutesLeft ?? toLimit, endSoc: limit };
}

/** A session's cost: the recorded one, else the home-rate estimate. */
export function sessionCost(
  s: Pick<ChargingSessionDto, 'cost' | 'estimatedCost'>,
): { amount: number; estimated: boolean } | null {
  const raw = s.cost ?? s.estimatedCost;
  const amount = raw == null || raw === '' ? NaN : Number(raw);
  return Number.isFinite(amount) ? { amount, estimated: s.cost == null } : null;
}

/** Energy and cost across sessions; cost is null when none has one. */
export function sessionTotals(
  sessions: readonly Pick<ChargingSessionDto, 'energyKwh' | 'cost' | 'estimatedCost'>[],
) {
  let energyKwh = 0;
  let cost: number | null = null;
  let estimated = false;
  for (const s of sessions) {
    energyKwh += s.energyKwh ?? 0;
    const c = sessionCost(s);
    if (c) {
      cost = (cost ?? 0) + c.amount;
      estimated ||= c.estimated;
    }
  }
  return { energyKwh, cost, estimated };
}

/**
 * Battery level the latest finished charge ended at, newest sessions first;
 * stands in for the charge limit when the vehicle doesn't report one.
 */
export function lastChargedTo(
  sessions: readonly Pick<ChargingSessionDto, 'endedAt' | 'endSoc'>[] | undefined,
): number | null {
  return sessions?.find((s) => s.endedAt != null && s.endSoc != null)?.endSoc ?? null;
}
