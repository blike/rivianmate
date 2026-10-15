import { useMemo, useState } from 'react';
import { useDrive, useDrives, useInsights, useUnits } from '../../api/hooks';
import {
  ContentFrame,
  LoadingScope,
  SkeletonBlock,
  SkeletonRows,
} from '../../components/LoadingState';
import { Panel } from '../../components/Panel';
import { TrendChart } from '../../components/TrendChart';
import { VehicleMap } from '../../components/VehicleMap';
import { driveProfile, minuteTicks, profilePosition } from '../../lib/drives';
import { isPosition } from '../../lib/geo';
import { DriveCard } from './DriveCard';
import { DriveList } from './DriveList';
import { DrivePicker } from './DrivePicker';
import { formatMinutes, tooltipTime } from './format';

export function DrivesPage(props: { vehicleId: string }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const u = useUnits();

  const { data: drives, isPending: drivesPending } = useDrives(props.vehicleId);
  // The newest drive until one is picked.
  const driveId = selectedId ?? drives?.[0]?.id ?? null;

  // While the next drive loads, the previous one stays on screen, dimmed.
  const {
    data: detail,
    isPending: detailPending,
    isPlaceholderData: showingPreviousDrive,
  } = useDrive(driveId);
  const loading = drivesPending || (driveId != null && detailPending);

  const trail = useMemo(
    () =>
      (detail?.points ?? [])
        .filter((p) => isPosition(p.lat, p.lon))
        .map((p) => [p.lat, p.lon] as [number, number]),
    [detail],
  );
  const lastPoint = trail.at(-1);

  // The drive under way shows where navigation is taking it, until it ends.
  const { data: insights } = useInsights(props.vehicleId);
  const navigation = insights?.navigation;
  const underWay = detail != null && !detail.endedAt && detail.id === drives?.[0]?.id;
  const plan =
    underWay && navigation
      ? {
          route: navigation.route,
          destination: [navigation.destination.lat, navigation.destination.lon] as [number, number],
        }
      : null;

  const profile = useMemo(
    () =>
      detail
        ? driveProfile(detail.points, detail.startedAt).map((p) => ({
            minutes: p.minutes,
            speed: u.distance(p.speedKmh),
            elevation: u.elevation(p.altitudeM),
            lat: p.lat,
            lon: p.lon,
          }))
        : [],
    [detail, u],
  );
  // The chart point under the pointer, marked on the route map.
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const hoverPosition = hoverIndex != null ? profilePosition(profile, hoverIndex) : null;

  if (!drivesPending && !drives?.length) {
    return (
      <Panel title="Drives">
        <p className="py-6 text-center text-sm text-(--text-muted)">No drives recorded yet.</p>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      {drives && drives.length > 1 && (
        <DrivePicker drives={drives} selectedId={driveId} onSelect={setSelectedId} />
      )}
      <div className={`transition-opacity ${showingPreviousDrive ? 'opacity-50' : ''}`}>
        <LoadingScope loading={loading}>
          <DriveCard drive={detail} />
        </LoadingScope>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel
          title="Route"
          className={`flex flex-col transition-opacity ${showingPreviousDrive ? 'opacity-50' : ''}`}
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
          <div className="mt-4">
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
                xTicks={minuteTicks(profile[0]?.minutes ?? 0, profile.at(-1)?.minutes ?? 0)}
                xFormatter={formatMinutes(profile.at(-1)?.minutes ?? 0)}
                tooltipLabel={detail ? tooltipTime(detail.startedAt) : undefined}
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
          </div>
        </Panel>

        <Panel title="All drives" className="hidden flex-col lg:flex">
          <div className="relative min-h-0 flex-1">
            <div className="-mx-4 max-h-112 overflow-auto lg:absolute lg:inset-0 lg:max-h-none">
              {drivesPending ? (
                <div className="px-4">
                  <SkeletonRows rows={8} />
                </div>
              ) : (
                <DriveList drives={drives!} selectedId={driveId} onSelect={setSelectedId} />
              )}
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
