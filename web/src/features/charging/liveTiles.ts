import type { useUnits } from '../../api/hooks';
import type { StatTile } from '../../components/StatTiles';
import type { LiveCharge } from '../../lib/liveCharge';
import { fmt, fmtSeconds } from '../../lib/state';

/** A charge in progress's power, energy so far and time left. */
export function liveTiles(c: LiveCharge, u: ReturnType<typeof useUnits>): StatTile[] {
  return [powerTile(c, u), energyTile(c.energyKwh, c.rangeAddedKm, u), timeLeftTile(c)];
}

export function powerTile(c: LiveCharge, u: ReturnType<typeof useUnits>): StatTile {
  return {
    label: 'Power',
    value: c.powerKw != null ? `${fmt(c.powerKw, 1)} kW` : '—',
    sub: c.rateKmh != null ? u.formatChargeRate(c.rateKmh) : undefined,
  };
}

export function energyTile(
  energyKwh: number | null,
  rangeAddedKm: number | null,
  u: ReturnType<typeof useUnits>,
): StatTile {
  return {
    label: 'Energy added',
    value: energyKwh != null ? `${fmt(energyKwh, 1)} kWh` : '—',
    sub: rangeAddedKm != null ? `${u.formatDistance(rangeAddedKm)} of range` : undefined,
  };
}

export function timeLeftTile(c: LiveCharge): StatTile {
  return {
    label: 'Time remaining',
    value: c.secondsLeft != null && c.secondsLeft > 0 ? fmtSeconds(c.secondsLeft) : '—',
    sub: c.finish ? `Done around ${c.finish}` : undefined,
  };
}
