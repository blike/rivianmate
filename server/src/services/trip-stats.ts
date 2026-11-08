import type { ChargingSessionDto, DriveDto, TripCostDto, TripStatsDto } from '../api-types.js';

/** A trip's totals, leaving out rather than guessing at figures that aren't known. */
export function tripStats(
  drives: readonly DriveDto[],
  sessions: readonly ChargingSessionDto[],
  /** The currency of a cost recorded without one, entered by hand. */
  defaultCurrency: string,
): TripStatsDto {
  const stats: TripStatsDto = {
    drives: drives.length,
    charges: sessions.length,
    startedAt: null,
    endedAt: null,
    lastStartedAt: null,
    distanceKm: 0,
    drivesWithDistance: 0,
    drivingSeconds: 0,
    chargingSeconds: 0,
    chargesWithTime: 0,
    energyUsedKwh: 0,
    energyAddedKwh: 0,
    energyAddedEstimated: false,
    chargesWithEnergy: 0,
    efficiency: null,
    costs: [],
    chargesWithCost: 0,
  };

  const starts = [...drives, ...sessions].map((a) => Date.parse(a.startedAt));
  const ends = [...drives, ...sessions].map((a) => Date.parse(a.endedAt ?? a.startedAt));
  if (starts.length > 0) {
    stats.startedAt = new Date(Math.min(...starts)).toISOString();
    stats.endedAt = new Date(Math.max(...ends)).toISOString();
    stats.lastStartedAt = new Date(Math.max(...starts)).toISOString();
  }

  for (const d of drives) {
    if (d.distanceKm != null) {
      stats.distanceKm += d.distanceKm;
      stats.drivesWithDistance++;
    }
    if (d.endedAt) {
      stats.drivingSeconds += Math.max(0, Date.parse(d.endedAt) - Date.parse(d.startedAt)) / 1000;
    }
    const energy = tripEnergyKwh(d);
    if (energy != null) {
      stats.energyUsedKwh += energy;
      if (d.distanceKm != null && d.distanceKm > 0) {
        stats.efficiency ??= { distanceKm: 0, energyKwh: 0, drives: 0 };
        stats.efficiency.distanceKm += d.distanceKm;
        stats.efficiency.energyKwh += energy;
        stats.efficiency.drives++;
      }
    }
  }
  // Nothing used across every drive leaves no efficiency to give.
  if (stats.efficiency && stats.efficiency.energyKwh <= 0) stats.efficiency = null;

  const costs = new Map<string, TripCostDto>();
  for (const s of sessions) {
    if (s.chargingSeconds != null) {
      stats.chargingSeconds += s.chargingSeconds;
      stats.chargesWithTime++;
    }
    const energy = s.energyKwh ?? s.estimatedEnergyKwh;
    if (energy != null) {
      stats.energyAddedKwh += energy;
      stats.chargesWithEnergy++;
      if (s.energyKwh == null) stats.energyAddedEstimated = true;
    }
    const raw = s.cost ?? s.estimatedCost;
    const amount = raw == null || raw === '' ? NaN : Number(raw);
    if (Number.isFinite(amount)) {
      const currency = s.currency ?? defaultCurrency;
      const total = costs.get(currency) ?? { currency, amount: 0, estimated: false };
      total.amount += amount;
      total.estimated ||= s.cost == null;
      costs.set(currency, total);
      stats.chargesWithCost++;
    }
  }
  stats.costs = [...costs.values()];
  return stats;
}

/**
 * What a drive used toward the trip's total. A drive whose battery ended
 * higher (a long way downhill) has no energy figure of its own, but it was
 * driven on next to nothing: it counts as none, so its distance isn't left
 * out, without crediting a gain that's partly reading noise.
 */
function tripEnergyKwh(d: DriveDto): number | null {
  if (d.energyKwh != null) return d.energyKwh;
  if (d.startBattery != null && d.endBattery != null && d.endBattery >= d.startBattery) return 0;
  return null;
}
