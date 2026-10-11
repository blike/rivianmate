import type { DriveDto } from '@server/api-types';
import { useUnits } from '../../api/hooks';
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
      <div className="flex min-w-0 items-center gap-2 text-base font-medium">
        {loading ? (
          <Skeleton className="w-[14em]" />
        ) : to == null ? (
          <>
            <span className="min-w-0 truncate" title={d?.start?.address ?? from}>
              <span className="text-(--text-muted)">From </span>
              {from}
            </span>
            <span className="ml-auto shrink-0 rounded-full border border-(--border) px-2 py-0.5 text-xs font-normal text-(--text-muted)">
              No destination
            </span>
          </>
        ) : (
          <>
            <span className="max-w-[45%] shrink-0 truncate" title={d?.start?.address ?? from}>
              {from}
            </span>
            <span className="shrink-0 text-(--accent)" aria-label="to">
              →
            </span>
            <span className="truncate" title={d?.end?.address ?? to}>
              {to}
            </span>
          </>
        )}
      </div>
      <ActivityStats items={stats} />
    </ActivityCard>
  );
}
