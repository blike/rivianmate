import type { DriveDetailDto, DrivePlaceDto } from '@server/api-types';
import { useUnits } from '../../api/hooks';
import { Dot } from '../../components/Dot';
import { HomeIcon } from '../../components/HomeIcon';
import { Skeleton, useLoading } from '../../components/LoadingState';
import { type StatTile, StatTiles } from '../../components/StatTiles';
import { averageSpeedKmh, rangeUsedKm } from '../../lib/drives';
import { clock, longDay } from '../../lib/format';
import { fmt, fmtDuration, titleCase } from '../../lib/state';
import { batteryUsed, batteryChange } from './format';

/** The chosen drive: where it went up front, then its figures. */
export function DriveCard(props: { drive: DriveDetailDto | undefined }) {
  const u = useUnits();
  const loading = useLoading();
  const d = props.drive;
  const live = d != null && !d.endedAt;
  const used = d ? batteryUsed(d) : null;
  const rangeUsed = d ? rangeUsedKm(d.startRangeKm, d.endRangeKm) : null;
  const avgSpeed = d ? averageSpeedKmh(d.distanceKm, d.startedAt, d.endedAt) : null;
  const to =
    d?.end?.label ?? (live && d?.destination?.name ? `Navigating to ${d.destination.name}` : null);

  const tiles: StatTile[] = [
    { label: 'Distance', value: u.formatDistance(d?.distanceKm, 1) },
    {
      label: 'Duration',
      value: d ? fmtDuration(d.startedAt, d.endedAt) : '—',
      sub: avgSpeed != null ? `${u.formatSpeed(avgSpeed)} average` : undefined,
    },
    {
      label: 'Efficiency',
      value: u.formatEfficiency(d?.distanceKm, d?.energyKwh),
      sub: d?.energyKwh != null ? `${fmt(d.energyKwh, 1)} kWh used` : undefined,
    },
    {
      label: 'Battery',
      value:
        d?.startBattery != null && d.endBattery != null
          ? `${fmt(d.startBattery, 1)}% → ${fmt(d.endBattery, 1)}%`
          : '—',
      sub:
        used != null
          ? `${batteryChange(used)}${rangeUsed != null ? ` · ${u.formatDistance(rangeUsed)} of range` : ''}`
          : undefined,
    },
    {
      label: 'Top speed',
      value: u.formatSpeed(d?.maxSpeedKmh),
      sub: d?.driveMode ? `${titleCase(d.driveMode)} mode` : undefined,
    },
    {
      label: 'Elevation',
      value:
        d?.elevationGainM != null || d?.elevationLossM != null
          ? `↑ ${u.formatElevation(d?.elevationGainM)}`
          : '—',
      sub: d?.elevationLossM != null ? `↓ ${u.formatElevation(d.elevationLossM)}` : undefined,
    },
  ];

  return (
    <section className="card overflow-hidden">
      <div className="p-5">
        <div className="flex items-center gap-2 text-xs text-(--text-muted)">
          {loading || !d ? (
            <Skeleton className="w-[14em]" />
          ) : (
            <>
              <span>
                {longDay(d.startedAt)} · {clock(d.startedAt)}
                {d.endedAt && ` – ${clock(d.endedAt)}`}
              </span>
              {live && (
                <span className="flex items-center gap-1.5 font-medium uppercase tracking-wide text-(--status-good)">
                  <Dot color="var(--status-good)" pulse />
                  In progress
                </span>
              )}
            </>
          )}
        </div>
        <h2 className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-2 text-base lg:text-xl font-semibold tracking-tight">
          {loading || !d ? (
            <Skeleton className="w-[16em]" />
          ) : (
            <>
              {live && to == null ? (
                <>
                  <span className="text-(--text-secondary)">From</span>
                  <Place place={d.start} />
                </>
              ) : (
                <>
                  <Place place={d.start} />
                  <span aria-label="to" className="text-(--text-muted)">
                    →
                  </span>
                  {d.end ? (
                    <Place place={d.end} />
                  ) : (
                    <span className="text-(--text-secondary)">{to ?? '—'}</span>
                  )}
                </>
              )}
            </>
          )}
        </h2>
      </div>
      <StatTiles tiles={tiles} columns="sm:grid-cols-3 lg:grid-cols-6" />
    </section>
  );
}

/** "Home" or a short address, with the full address on hover. */
function Place(props: { place: DrivePlaceDto | null }) {
  if (!props.place) return <span className="text-(--text-muted)">Unknown</span>;
  return (
    <span className="min-w-0 truncate" title={props.place.address ?? props.place.label}>
      {props.place.isHome && <HomeIcon />}
      {props.place.label}
    </span>
  );
}
