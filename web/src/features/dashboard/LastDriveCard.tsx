import type { DriveDto, DrivePlaceDto } from '@server/api-types';
import { useUnits } from '../../api/hooks';
import { InProgressTag } from '../../components/InProgressTag';
import { PlaceIcon } from '../../components/PlaceIcon';
import { LoadingScope, Skeleton, useLoading } from '../../components/LoadingState';
import { relativeTime } from '../../lib/freshness';
import {
  type Navigation,
  arrivalFacts,
  moreStops,
  nextStop,
  routeProgress,
  stopFacts,
  stopMarks,
} from '../../lib/navigation';
import { fmt, fmtDuration } from '../../lib/state';
import { batteryUsed } from '../drives/format';
import { ActivityBar, ActivityCard, ActivityLine, ActivityStats, StopNumber } from './ActivityCard';
import { DriveIcon } from './ActivityIcons';

/** Battery left on the activity bar, and the part a drive used (red) or gained (green). */
const BATTERY_LEFT = 'color-mix(in srgb, var(--text-secondary) 55%, var(--surface-2))';
const BATTERY_USED = 'var(--status-critical)';
const BATTERY_GAINED = 'var(--status-good)';

/** The drive under way, or the last one. */
export function LastDriveCard(props: {
  drive: DriveDto | undefined;
  now: number;
  speedMps: number | null;
  /** The vehicle's active navigation, if any. */
  navigation?: Navigation | null;
  /** Whether navigation has loaded: a drive under way is laid out by it. */
  navigationLoaded?: boolean;
  /**
   * Whether vehicle state says it's driving, so the card is titled right
   * while drives load; undefined while state hasn't loaded either.
   */
  inGear?: boolean;
}) {
  const loading = useLoading();
  const u = useUnits();
  const d = props.drive;
  const live = d != null && !d.endedAt;
  const pending = d == null && props.inGear === true;
  const underWay = live || pending;
  // Which line, bar and figures to show isn't settled until it's known
  // whether a drive is under way and, if so, whether it's navigating.
  const settled =
    (d != null || props.inGear !== undefined) && (!underWay || props.navigationLoaded !== false);
  // The start is looked up as a drive begins; give it a couple of minutes.
  const locating = live && props.now - Date.parse(d.startedAt) < 2 * 60_000;
  const from = d?.start?.label ?? (locating ? 'Locating start…' : 'Unknown');
  const nav = underWay ? (props.navigation ?? null) : null;
  // A drive under way has an end only if navigation set one: its next stop.
  const next = nav ? nextStop(nav) : null;
  const to = live ? (next?.name ?? d?.destination?.name ?? null) : (d?.end?.label ?? 'Unknown');
  const arrival = nav ? arrivalFacts(nav, u) : null;
  const progress = nav && d ? routeProgress(d.distanceKm, nav.remainingKm) : null;
  // With stops on the way, the figures are the next stop's, then the destination's.
  const stops = nav && nav.stops.length > 1 ? nav.stops.length : 0;
  const toNext = nav && stops > 0 ? stopFacts(nav.stops[0]!, u) : null;
  const marks = nav && d ? stopMarks(d.distanceKm, nav) : [];
  const duration = d ? fmtDuration(d.startedAt, d.endedAt, props.now) : '—';
  const speed = props.speedMps != null ? u.formatSpeed(Math.max(0, props.speedMps) * 3.6) : '—';

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
      title={
        loading && !d && props.inGear === undefined ? (
          <Skeleton className="w-[6em]" />
        ) : underWay ? (
          'Driving now'
        ) : (
          'Last drive'
        )
      }
      when={
        pending ? (
          <InProgressTag />
        ) : loading || !d ? (
          <Skeleton className="w-[4em]" />
        ) : live ? (
          <InProgressTag />
        ) : (
          relativeTime(new Date(d.endedAt!), props.now)
        )
      }
      icon={<DriveIcon />}
    >
      <LoadingScope loading={loading || !settled}>
        <ActivityLine
          wrap
          note={
            live && to == null ? 'No destination' : live ? moreStops(next?.after ?? 0) : undefined
          }
        >
          {to == null ? (
            <>
              <span className="text-(--text-muted)">From</span>
              <Place place={d?.start} fallback={from} />
            </>
          ) : (
            <>
              <Place place={d?.start} fallback={from} />
              <span className="text-(--accent)" aria-label="to">
                →
              </span>
              <Place place={live ? null : d?.end} fallback={to} />
            </>
          )}
        </ActivityLine>

        {nav ? (
          <ActivityBar
            label={progress != null ? `${Math.round(progress * 100)}% of the way` : undefined}
            segments={
              progress != null ? [{ from: 0, to: progress * 100, color: 'var(--accent)' }] : []
            }
            dot={progress != null ? { at: progress * 100, color: 'var(--accent)' } : null}
            stops={marks.map((s) => ({ ...s, at: s.at * 100 }))}
            left={`${u.formatDistance(d?.distanceKm, 1)} driven`}
            right={
              toNext?.distanceLeft && arrival?.distanceLeft
                ? `${toNext.distanceLeft} to next · ${arrival.distanceLeft} to go`
                : arrival?.distanceLeft
                  ? `${arrival.distanceLeft} to go`
                  : undefined
            }
          />
        ) : (
          <BatteryBar drive={d} live={underWay} />
        )}

        <ActivityStats
          items={
            toNext
              ? [
                  { label: <Numbered n={1}>Arrives</Numbered>, value: toNext.eta ?? '—' },
                  { label: <Numbered n={1}>Time left</Numbered>, value: toNext.timeLeft ?? '—' },
                  {
                    label: <Numbered n={stops}>Arrives</Numbered>,
                    value: [arrival?.eta ?? '—', arrival?.battery].filter(Boolean).join(' · '),
                  },
                ]
              : nav
                ? [
                    { label: 'Arrives', value: arrival?.eta ?? '—' },
                    { label: 'Time left', value: arrival?.timeLeft ?? '—' },
                    { label: 'Arrival battery', value: arrival?.battery ?? '—' },
                  ]
                : [
                    { label: 'Distance', value: u.formatDistance(d?.distanceKm, 1) },
                    { label: 'Duration', value: duration },
                    underWay
                      ? { label: 'Speed', value: speed }
                      : {
                          label: 'Efficiency',
                          value: u.formatEfficiency(d?.distanceKm, d?.energyKwh),
                        },
                  ]
          }
        />
      </LoadingScope>
    </ActivityCard>
  );
}

/** The battery the drive started with, and what it's used of it. */
function BatteryBar(props: { drive: DriveDto | undefined; live: boolean }) {
  const d = props.drive;
  const start = d?.startBattery ?? null;
  const end = d?.endBattery ?? null;
  if (start == null || end == null) {
    return <ActivityBar segments={[]} left="Battery not recorded" />;
  }
  const used = batteryUsed({ startBattery: start, endBattery: end });
  return (
    <ActivityBar
      label={`Battery ${fmt(start, 0)}% to ${fmt(end, 0)}%`}
      segments={[
        { from: 0, to: Math.min(start, end), color: BATTERY_LEFT },
        end < start
          ? { from: end, to: start, color: BATTERY_USED }
          : { from: start, to: end, color: BATTERY_GAINED },
      ]}
      left={`Battery ${fmt(start, 1)}% → ${fmt(end, 1)}%`}
      right={
        used == null
          ? 'No change'
          : `${used > 0 ? 'Used' : 'Gained'} ${fmt(Math.abs(used), 1)}%${props.live ? ' so far' : ''}`
      }
    />
  );
}

/** A saved location's name with its icon, or a short address, with the full address on hover. */
function Place(props: { place: DrivePlaceDto | null | undefined; fallback: string }) {
  const p = props.place;
  return (
    <span title={p?.address ?? p?.label ?? props.fallback}>
      {p && <PlaceIcon isHome={p.isHome} saved={p.locationId != null} />}
      {p?.label ?? props.fallback}
    </span>
  );
}

/** A figure's label for one stop of the route, by its number. */
function Numbered(props: { n: number; children: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <StopNumber number={props.n} className="h-3.5 w-3.5 text-[8px]" />
      {props.children}
    </span>
  );
}
