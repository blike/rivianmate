import type { DriveDto, DrivePlaceDto } from '@server/api-types';
import { useUnits } from '../../api/hooks';
import { PlaceIcon } from '../../components/PlaceIcon';
import { Skeleton, useLoading } from '../../components/LoadingState';
import { relativeTime } from '../../lib/freshness';
import { fmt, fmtDuration } from '../../lib/state';
import { ActivityCard, ActivityStats } from './ActivityCard';
import { DriveIcon } from './ActivityIcons';

export function LastDriveCard(props: {
  drive: DriveDto | undefined;
  now: number;
  speedMps: number | null;
}) {
  const loading = useLoading();
  const u = useUnits();
  const d = props.drive;
  const live = d != null && !d.endedAt;
  const used =
    d?.startBattery != null && d.endBattery != null ? d.startBattery - d.endBattery : null;
  // The start is looked up as a drive begins; give it a couple of minutes.
  const locating = live && props.now - Date.parse(d.startedAt) < 2 * 60_000;
  const from = d?.start?.label ?? (locating ? 'Locating start…' : 'Unknown');
  // A drive under way has an end only if navigation set one.
  const to = live ? (d?.destination?.name ?? null) : (d?.end?.label ?? 'Unknown');
  const stats = [
    { label: 'Distance', value: u.formatDistance(d?.distanceKm, 1) },
    { label: 'Duration', value: d ? fmtDuration(d.startedAt, d.endedAt, props.now) : '—' },
    ...(live
      ? [
          {
            label: 'Speed',
            value: props.speedMps != null ? u.formatSpeed(Math.max(0, props.speedMps) * 3.6) : '—',
          },
        ]
      : []),
    { label: 'Battery', value: used == null ? '—' : used < 0.05 ? '0%' : `−${fmt(used, 1)}%` },
  ];

  if (!loading && !d) {
    return (
      <ActivityCard to="/drives" title="Last drive" when="" icon={<DriveIcon />}>
        <p className="text-sm text-(--text-muted)">
          No drives recorded yet. They appear here after the first trip.
        </p>
      </ActivityCard>
    );
  }

  return (
    <ActivityCard
      to="/drives"
      title={live ? 'Driving now' : 'Last drive'}
      when={
        loading || !d ? (
          <Skeleton className="w-[4em]" />
        ) : live ? (
          'In progress'
        ) : (
          relativeTime(new Date(d.endedAt!), props.now)
        )
      }
      icon={<DriveIcon />}
    >
      {/* Places wrap onto their own lines, as on the Drives page, before truncating. */}
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-base font-medium">
        {loading ? (
          <Skeleton className="w-[14em]" />
        ) : to == null ? (
          <>
            <span className="text-(--text-muted)">From</span>
            <Place place={d?.start} fallback={from} />
            <span className="ml-auto shrink-0 self-center rounded-full border border-(--border) px-2 py-0.5 text-xs font-normal text-(--text-muted)">
              No destination
            </span>
          </>
        ) : (
          <>
            <Place place={d?.start} fallback={from} />
            <span className="shrink-0 text-(--accent)" aria-label="to">
              →
            </span>
            <Place place={live ? null : d?.end} fallback={to} />
          </>
        )}
      </div>
      <ActivityStats items={stats} />
    </ActivityCard>
  );
}

/** A saved location's name with its icon, or a short address, with the full address on hover. */
function Place(props: { place: DrivePlaceDto | null | undefined; fallback: string }) {
  const p = props.place;
  return (
    <span className="min-w-0 truncate" title={p?.address ?? p?.label ?? props.fallback}>
      {p && <PlaceIcon isHome={p.isHome} saved={p.locationId != null} />}
      {p?.label ?? props.fallback}
    </span>
  );
}
