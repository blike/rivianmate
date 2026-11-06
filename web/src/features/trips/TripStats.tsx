import type { TripDetailDto } from '../../api/client';
import { useUnits } from '../../api/hooks';
import { type StatTile, StatTiles } from '../../components/StatTiles';
import { plural } from '../../lib/format';
import { fmt, fmtSeconds } from '../../lib/state';
import { costsLabel, coverage } from './trips';

/** The whole journey's figures, each saying when it doesn't cover everything. */
export function TripStats(props: { stats: TripDetailDto['stats'] }) {
  const u = useUnits();
  const s = props.stats;
  const efficiency = s.efficiency;
  const costs = costsLabel(s.costs);
  const tiles: StatTile[] = [
    {
      label: 'Distance',
      value: s.drivesWithDistance > 0 ? u.formatDistance(s.distanceKm) : '—',
      sub: coverage(s.drivesWithDistance, s.drives, 'drives') ?? plural(s.drives, 'drive'),
    },
    {
      label: 'Driving time',
      value: s.drives > 0 ? fmtSeconds(s.drivingSeconds) : '—',
    },
    {
      label: 'Energy used',
      value: s.energyUsedKwh > 0 ? `≈ ${fmt(s.energyUsedKwh, 1)} kWh` : '—',
      sub: s.energyUsedKwh > 0 ? 'From battery level' : undefined,
    },
    {
      label: 'Efficiency',
      value: efficiency ? u.formatEfficiency(efficiency.distanceKm, efficiency.energyKwh) : '—',
      sub: efficiency ? coverage(efficiency.drives, s.drives, 'drives') : undefined,
    },
    {
      label: 'Time charging',
      value: s.chargesWithTime > 0 ? fmtSeconds(s.chargingSeconds) : '—',
      sub: coverage(s.chargesWithTime, s.charges, 'charges') ?? plural(s.charges, 'charge'),
    },
    {
      label: 'Energy added',
      value:
        s.chargesWithEnergy > 0
          ? `${s.energyAddedEstimated ? '≈ ' : ''}${fmt(s.energyAddedKwh, 1)} kWh`
          : '—',
      sub: coverage(s.chargesWithEnergy, s.charges, 'charges'),
    },
    {
      label: 'Cost',
      value: costs ?? '—',
      sub: costs ? coverage(s.chargesWithCost, s.charges, 'charges') : undefined,
    },
  ];
  return <StatTiles tiles={tiles} columns="sm:grid-cols-3 lg:grid-cols-7" />;
}
