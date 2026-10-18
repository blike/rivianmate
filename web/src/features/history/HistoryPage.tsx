import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api } from '../../api/client';
import { useChargingSessions, useDrives } from '../../api/hooks';
import { ContentFrame, LoadingScope } from '../../components/LoadingState';
import { Panel } from '../../components/Panel';
import { TRIPS_LEGEND, VehicleMap } from '../../components/VehicleMap';
import { isPosition } from '../../lib/geo';
import { DistancePanel } from './DistancePanel';
import { activityBands, periodSummary, positionAt, rangeWindow, tripLines } from './history';
import { MetricChart } from './MetricChart';
import { RANGES, METRICS } from './options';
import { Segmented } from './Segmented';
import { StatePanel } from './StatePanel';
import { SummaryCard } from './SummaryCard';

export function HistoryPage(props: { vehicleId: string }) {
  const [rangeIdx, setRangeIdx] = useState(1);
  const [metricIdx, setMetricIdx] = useState(0);
  const range = RANGES[rangeIdx] ?? RANGES[1]!;
  const metric = METRICS[metricIdx] ?? METRICS[0]!;

  const { from, to } = useMemo(() => rangeWindow(range.hours, new Date()), [range.hours]);

  const { data: drives, isPending: drivesPending } = useDrives(props.vehicleId);
  const { data: sessions, isPending: sessionsPending } = useChargingSessions(props.vehicleId);
  const { data: spans, isPending: spansPending } = useQuery({
    queryKey: ['chargeSpans', props.vehicleId, range.label],
    queryFn: () => api.chargeSpans(props.vehicleId, from, to),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });

  const { data: trail, isPending: trailPending } = useQuery({
    queryKey: ['locations', props.vehicleId, range.label],
    queryFn: () => api.locations(props.vehicleId, from, to),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
  const fixes = useMemo(
    () =>
      (trail ?? [])
        .filter((p) => isPosition(p.lat, p.lon))
        .map((p) => ({ ts: Date.parse(p.ts), lat: p.lat, lon: p.lon })),
    [trail],
  );
  const trips = useMemo(
    () => tripLines((trail ?? []).filter((p) => isPosition(p.lat, p.lon))),
    [trail],
  );
  const lastPosition = fixes.at(-1);
  // Hovering the chart marks where the vehicle was at that moment.
  const [hoverTs, setHoverTs] = useState<number | null>(null);
  const hoverPosition = hoverTs != null ? positionAt(fixes, hoverTs) : null;

  const activityPending = drivesPending || sessionsPending;
  const summary = useMemo(
    () => periodSummary(drives ?? [], sessions ?? [], from.getTime(), to.getTime()),
    [drives, sessions, from, to],
  );
  const bands = useMemo(
    () => activityBands(drives ?? [], spans ?? [], from.getTime(), to.getTime()),
    [drives, spans, from, to],
  );

  return (
    <div className="space-y-4">
      <SummaryCard
        range={range}
        rangeIdx={rangeIdx}
        onRange={setRangeIdx}
        summary={summary}
        activityPending={activityPending}
      />

      <LoadingScope loading={drivesPending}>
        <DistancePanel drives={drives ?? []} from={from} to={to} hours={range.hours} />
      </LoadingScope>

      <Panel
        title={metric.label}
        action={
          <Segmented
            items={METRICS.map((m) => m.label)}
            value={metricIdx}
            onChange={setMetricIdx}
          />
        }
      >
        <MetricChart
          vehicleId={props.vehicleId}
          metric={metric}
          range={range}
          from={from}
          to={to}
          bands={drivesPending || spansPending ? [] : bands}
          onHover={setHoverTs}
        />
      </Panel>

      <Panel
        title="Location history"
        action={
          <span className="flex items-center gap-1.5 text-xs text-(--text-muted)">
            Once
            <span className="h-2 w-16 rounded-full" style={{ background: TRIPS_LEGEND }} />
            Often
          </span>
        }
      >
        <ContentFrame
          height="24rem"
          loading={trailPending}
          empty={fixes.length === 0}
          emptyText="No location points in this period."
        >
          {lastPosition && (
            <VehicleMap
              lat={lastPosition.lat}
              lon={lastPosition.lon}
              trips={trips}
              variant="history"
              height="24rem"
              follow={false}
              highlight={hoverPosition}
            />
          )}
        </ContentFrame>
      </Panel>

      <StatePanel
        vehicleId={props.vehicleId}
        rangeLabel={range.label}
        hours={range.hours}
        from={from}
        to={to}
      />
    </div>
  );
}
