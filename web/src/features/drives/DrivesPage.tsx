import { useMemo, useState } from 'react';
import {
  useDrive,
  useDriveCoverage,
  useDrivePages,
  useInsights,
  useUnits,
  useVehicleState,
} from '../../api/hooks';
import type { LocationPointDto } from '@server/api-types';
import { api, type DriveDetailDto } from '../../api/client';
import { DayCalendar } from '../../components/DayCalendar';
import { PageHeader } from '../../components/PageHeader';
import {
  ContentFrame,
  LoadingScope,
  SkeletonBlock,
  SkeletonRows,
} from '../../components/LoadingState';
import { AddToTrip } from '../../components/AddToTrip';
import { LoadOlder } from '../../components/LoadOlder';
import { Panel } from '../../components/Panel';
import { TrendChart } from '../../components/TrendChart';
import { VehicleMap } from '../../components/VehicleMap';
import { CHART_POINTS, driveProfile, evenly, minuteTicks, profilePosition } from '../../lib/drives';
import { useGoToDate } from '../../lib/goToDate';
import { useLiveTrail } from '../../lib/liveTrail';
import { routePlan } from '../../lib/navigation';
import { location } from '../../lib/state';
import { DriveCard } from './DriveCard';
import { DriveList } from './DriveList';
import { DrivePicker } from './DrivePicker';
import { formatMinutes, tooltipTime } from './format';

export function DrivesPage(props: { vehicleId: string }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const pages = useDrivePages(props.vehicleId);
  const { items: drives, isPending: drivesPending } = pages;
  const older = { has: pages.hasOlder, loading: pages.loadingOlder, load: pages.loadOlder };
  const newer = {
    has: pages.hasNewer,
    loading: pages.loadingNewer,
    load: pages.loadNewer,
    // Back to the newest, and to showing it.
    latest: () => {
      pages.jumpTo(null);
      setSelectedId(null);
    },
  };
  // The newest drive until one is picked.
  const driveId = selectedId ?? drives?.[0]?.id ?? null;

  // While the next drive loads, the previous one stays on screen, dimmed.
  const {
    data: detail,
    isPending: detailPending,
    isPlaceholderData: showingPreviousDrive,
  } = useDrive(props.vehicleId, driveId);
  const loading = drivesPending || (driveId != null && detailPending);

  // Going to a date: a calendar of the month with each day's drives.
  const { data: coverage } = useDriveCoverage(props.vehicleId);
  const goTo = useGoToDate({
    queryKey: ['drives', props.vehicleId],
    fetchWindow: (from, to) => api.drives(props.vehicleId, { from, to }),
    listed: drives,
    jumpTo: pages.jumpTo,
    selected: detail,
    onSelect: setSelectedId,
    earliest: coverage?.since ? new Date(coverage.since) : null,
  });
  const calendar = <DayCalendar noun="drive" {...goTo.calendar} />;
  const underWay = detail != null && !detail.endedAt && detail.id === drives?.[0]?.id;

  if (!drivesPending && !drives?.length) {
    return (
      <>
        <PageHeader title="Drives" />
        <Panel title="Drives">
          <p className="py-6 text-center text-sm text-(--text-muted)">No drives recorded yet.</p>
        </Panel>
      </>
    );
  }

  return (
    <>
      {/* Until the list shows beside the details, the calendar sits at the header's
          right, so the picker has the width. */}
      <PageHeader title="Drives" action={<div className="lg:hidden">{calendar}</div>} />
      <div className="space-y-4">
        {drives && drives.length > 1 && (
          <DrivePicker
            drives={drives}
            selectedId={driveId}
            onSelect={setSelectedId}
            older={older}
            newer={newer}
            className="sticky top-2 z-20 lg:hidden"
          />
        )}
        <div className={`transition-opacity ${showingPreviousDrive ? 'opacity-50' : ''}`}>
          <LoadingScope loading={loading}>
            <DriveCard
              vehicleId={props.vehicleId}
              drive={detail}
              action={
                detail?.endedAt ? (
                  <AddToTrip
                    vehicleId={props.vehicleId}
                    kind="drive"
                    activityId={detail.id}
                    startedAt={detail.startedAt}
                  />
                ) : undefined
              }
            />
          </LoadingScope>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <RoutePanel
            vehicleId={props.vehicleId}
            detail={detail}
            loading={loading}
            dimmed={showingPreviousDrive}
            underWay={underWay}
          />

          <Panel title="All drives" className="hidden flex-col lg:flex" action={calendar}>
            <div className="relative min-h-0 flex-1">
              <div
                className={`-mx-4 max-h-112 overflow-auto transition-opacity lg:absolute lg:inset-0 lg:max-h-none ${
                  pages.moving ? 'opacity-50' : ''
                }`}
              >
                {drivesPending ? (
                  <div className="px-4">
                    <SkeletonRows rows={8} />
                  </div>
                ) : (
                  <>
                    <DriveList
                      drives={drives!}
                      selectedId={driveId}
                      onSelect={setSelectedId}
                      revealId={goTo.revealId}
                      onRevealed={goTo.clearReveal}
                      newer={newer}
                    />
                    {older.has && (
                      <LoadOlder
                        label="Show older drives"
                        loading={older.loading}
                        onLoad={older.load}
                      />
                    )}
                  </>
                )}
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}

/**
 * A drive's route and its speed and elevation over time; hovering the
 * chart marks the spot on the map. The pointer moves only this: the
 * chart is drawn once per drive, and the list beside it not at all.
 */
function RoutePanel(props: {
  vehicleId: string;
  detail: DriveDetailDto | undefined;
  loading: boolean;
  /** The previous drive, shown while the next loads. */
  dimmed: boolean;
  underWay: boolean;
}) {
  const { detail, loading, underWay } = props;
  const u = useUnits();
  // The drive under way shows where navigation is taking it, and the
  // vehicle's latest fix and heading, until it ends.
  const { data: insights } = useInsights(props.vehicleId);
  const { data: state } = useVehicleState(props.vehicleId);
  const navigation = insights?.navigation;
  const trail = useLiveTrail(
    props.vehicleId,
    underWay ? detail! : null,
    detail?.points ?? NO_POINTS,
  );
  const lastPoint = trail.at(-1);
  const plan = underWay && navigation ? routePlan(navigation) : null;

  const profile = useMemo(() => {
    if (!detail) return [];
    // The map draws every point; the chart, enough to look the same.
    return evenly(driveProfile(detail.points, detail.startedAt), CHART_POINTS).map((p) => ({
      minutes: p.minutes,
      speed: u.distance(p.speedKmh),
      elevation: u.elevation(p.altitudeM),
      lat: p.lat,
      lon: p.lon,
    }));
  }, [detail, u]);
  // The chart point under the pointer, marked on the route map.
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const hoverPosition = hoverIndex != null ? profilePosition(profile, hoverIndex) : null;

  const startedAt = detail?.startedAt;
  const chart = useMemo(() => {
    const end = profile.at(-1)?.minutes ?? 0;
    return (
      <ContentFrame
        height={150}
        loading={loading}
        empty={profile.length < 2}
        emptyText="No speed or altitude readings for this drive."
      >
        <TrendChart
          data={profile}
          xKey="minutes"
          height={150}
          onHover={setHoverIndex}
          xTicks={minuteTicks(profile[0]?.minutes ?? 0, end)}
          xFormatter={formatMinutes(end)}
          tooltipLabel={startedAt ? tooltipTime(startedAt) : undefined}
          series={[
            {
              key: 'speed',
              label: 'Speed',
              color: 'var(--accent)',
              unit: u.speedUnit,
              digits: 0,
            },
            {
              key: 'elevation',
              label: 'Elevation',
              color: 'var(--series-1)',
              mark: 'line',
              right: true,
              unit: u.elevationUnit,
              digits: 0,
            },
          ]}
        />
      </ContentFrame>
    );
  }, [profile, loading, startedAt, u]);

  return (
    <Panel
      title="Route"
      className={`flex flex-col transition-opacity ${props.dimmed ? 'opacity-50' : ''}`}
    >
      <div className="relative h-88 overflow-hidden rounded-lg lg:h-104">
        {loading ? (
          <SkeletonBlock height="100%" />
        ) : detail && lastPoint ? (
          <div className="absolute inset-0">
            <VehicleMap
              key={detail.id}
              lat={lastPoint[0]}
              lon={lastPoint[1]}
              bearing={underWay ? (location(state)?.bearing ?? null) : null}
              trail={trail}
              height="100%"
              follow={false}
              highlight={hoverPosition}
              plan={plan}
            />
          </div>
        ) : (
          <p className="flex h-full items-center justify-center text-sm text-(--text-muted)">
            No GPS from the vehicle during this drive (it may have had no signal).
          </p>
        )}
      </div>
      <div className="mt-4">{chart}</div>
    </Panel>
  );
}

const NO_POINTS: LocationPointDto[] = [];
