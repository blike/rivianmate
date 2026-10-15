import type { ChargingSessionDto } from '@server/api-types';

/**
 * A session's energy: the charge under way's reading, else Rivian's, else
 * (until Rivian reports it, often only after unplugging) the estimate from
 * the battery gained.
 */
export function sessionEnergy(
  s: Pick<ChargingSessionDto, 'energyKwh' | 'estimatedEnergyKwh'> | undefined,
  liveKwh: number | null = null,
): { kwh: number; estimated: boolean } | null {
  const kwh = liveKwh ?? s?.energyKwh ?? null;
  if (kwh != null) return { kwh, estimated: false };
  return s?.estimatedEnergyKwh != null ? { kwh: s.estimatedEnergyKwh, estimated: true } : null;
}

/** Average power over the time spent charging (kW). */
export function averagePowerKw(kwh: number | null, chargingSeconds: number | null): number | null {
  if (kwh == null || chargingSeconds == null || chargingSeconds < 60) return null;
  return kwh / (chargingSeconds / 3600);
}
