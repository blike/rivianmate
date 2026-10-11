import { useUnits } from '../../api/hooks';
import { LoadingScope, Skeleton, useLoading } from '../../components/LoadingState';
import { type StatTile, StatTiles } from '../../components/StatTiles';
import { formatMoney } from '../../lib/charging';
import { fmt, fmtSeconds } from '../../lib/state';
import { periodSummary } from './history';
import { RANGES } from './options';
import { Segmented } from './Segmented';

/** The period at a glance: distance up front, then what else happened. */
export function SummaryCard(props: {
  range: (typeof RANGES)[number];
  rangeIdx: number;
  onRange: (i: number) => void;
  summary: ReturnType<typeof periodSummary>;
  activityPending: boolean;
}) {
  const u = useUnits();
  const s = props.summary;
  const tiles: StatTile[] = [
    {
      label: 'Drives',
      value: fmt(s.drives, 0),
      sub:
        s.drives > 0
          ? `${u.formatDistance(s.distanceKm / s.drives)} on average`
          : 'None in this period',
    },
    {
      label: 'Time driving',
      value: s.drivingSeconds > 0 ? fmtSeconds(s.drivingSeconds) : '—',
      sub:
        s.drivingSeconds > 0
          ? `${u.formatSpeed(s.distanceKm / (s.drivingSeconds / 3600))} average`
          : undefined,
    },
    {
      label: 'Efficiency',
      value: u.formatEfficiency(s.energyDistanceKm, s.energyKwh),
      sub: s.energyKwh > 0 ? `${fmt(s.energyKwh, 1)} kWh used` : undefined,
    },
    {
      label: 'Charged',
      value: s.sessions > 0 ? `${fmt(s.chargedKwh, 1)} kWh` : '—',
      sub: s.sessions > 0 ? `${s.sessions} session${s.sessions === 1 ? '' : 's'}` : 'No sessions',
    },
    {
      label: 'Charging cost',
      value:
        s.cost != null
          ? `${s.costEstimated ? '≈ ' : ''}${formatMoney(String(s.cost), s.currency)}`
          : '—',
      sub:
        s.cost != null && s.distanceKm > 0
          ? `${formatMoney(String(s.cost / (u.distance(s.distanceKm) ?? 1)), s.currency)} per ${u.distanceUnit}`
          : s.sessions > 0
            ? 'Add costs on the Charging page'
            : undefined,
    },
  ];

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-4 p-5">
        <div>
          <div className="text-xs text-(--text-muted)">Last {props.range.title}</div>
          <div className="mt-0.5 text-3xl font-semibold tabular-nums tracking-tight">
            <LoadingScope loading={props.activityPending}>
              <BigValue
                value={fmt(u.distance(s.distanceKm), 0)}
                unit={`${u.distanceUnit} driven`}
              />
            </LoadingScope>
          </div>
        </div>
        <Segmented
          items={RANGES.map((r) => r.label)}
          value={props.rangeIdx}
          onChange={props.onRange}
        />
      </div>
      <LoadingScope loading={props.activityPending}>
        <StatTiles tiles={tiles} columns="sm:grid-cols-3 lg:grid-cols-5" />
      </LoadingScope>
    </section>
  );
}

function BigValue(props: { value: string; unit: string }) {
  const loading = useLoading();
  if (loading) return <Skeleton className="w-[5em]" />;
  return (
    <>
      {props.value}
      <span className="ml-1.5 text-base font-normal text-(--text-muted)">{props.unit}</span>
    </>
  );
}
