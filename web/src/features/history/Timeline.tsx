import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import type { HistoryMetric, HistoryPoint } from '@server/api-types';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import { useUnits } from '../../api/hooks';
import { ContentFrame } from '../../components/LoadingState';
import { Panel, PanelSection } from '../../components/Panel';
import { type TraceBand, TimeTrace } from '../../components/TimeTrace';
import { type ActivityBand, type StateSegment, rangeWindow } from './history';
import { METRICS, prefetchRanges, PREFETCH_FRESH_MS, type Range } from './options';
import { Segmented } from '../../components/Segmented';
import { StateStrip } from './StateStrip';

/** Drives and charging behind the line; plugged in but idle is fainter. */
const BAND: Record<ActivityBand['kind'], { label: string; fill: string; swatch: string }> = {
  drive: {
    label: 'Driving',
    fill: 'color-mix(in srgb, var(--series-1) 16%, transparent)',
    swatch: 'color-mix(in srgb, var(--series-1) 55%, transparent)',
  },
  charging: {
    label: 'Charging',
    fill: 'color-mix(in srgb, var(--status-good) 20%, transparent)',
    swatch: 'color-mix(in srgb, var(--status-good) 65%, transparent)',
  },
  plugged: {
    label: 'Plugged in',
    fill: 'color-mix(in srgb, var(--status-good) 7%, transparent)',
    swatch: 'color-mix(in srgb, var(--status-good) 30%, transparent)',
  },
};

const historyQuery = (
  vehicleId: string,
  metric: HistoryMetric,
  range: Range,
  from: Date,
  to: Date,
) =>
  queryOptions({
    queryKey: ['history', vehicleId, metric, range.label],
    queryFn: () => api.history(vehicleId, metric, from, to, range.bucket),
    refetchInterval: 60_000,
    // Keep the old line while a new range loads; another metric's values
    // would be drawn on the wrong scale, so those show a placeholder instead.
    placeholderData: (previous: HistoryPoint[] | undefined, previousQuery) =>
      previousQuery?.queryKey[2] === metric ? previous : undefined,
  });

/**
 * The chosen metric over the period with drives and charging shaded behind
 * it, then the vehicle's state as a strip of its own; each with its legend.
 */
export function Timeline(props: {
  vehicleId: string;
  range: Range;
  from: Date;
  to: Date;
  bands: ActivityBand[];
  segments: StateSegment[];
  /** The bands or segments are still the last period's. */
  stale: boolean;
  /** Whether this period's window is known yet; all time waits on the first drive. */
  ready: boolean;
  onHover?: (ts: number | null) => void;
  /** Whether the metric for this period is still on its way. */
  onLoading?: (loading: boolean) => void;
}) {
  const { range, from, to } = props;
  const u = useUnits();
  const [metricIdx, setMetricIdx] = useState(0);
  const metric = METRICS[metricIdx] ?? METRICS[0]!;

  const {
    data: points,
    isPending,
    isSuccess,
    isPlaceholderData,
  } = useQuery({
    ...historyQuery(props.vehicleId, metric.key, range, from, to),
    enabled: props.ready,
  });

  // As the page does: the metric over the other periods, loaded behind this one.
  const queryClient = useQueryClient();
  const shownLoaded = isSuccess && !isPlaceholderData;
  const { onLoading } = props;
  useEffect(
    () => onLoading?.(isPending || isPlaceholderData),
    [onLoading, isPending, isPlaceholderData],
  );
  useEffect(() => {
    if (!shownLoaded) return;
    const now = new Date();
    for (const other of prefetchRanges(range)) {
      const w = rangeWindow(other.hours, now);
      void queryClient
        .query({
          ...historyQuery(props.vehicleId, metric.key, other, w.from, w.to),
          staleTime: PREFETCH_FRESH_MS,
        })
        .catch(() => {});
    }
  }, [shownLoaded, range, metric.key, props.vehicleId, queryClient]);

  const data = useMemo(
    () =>
      (points ?? []).map((p) => {
        const v = p.avg == null ? null : p.avg * (metric.scale ?? 1);
        return {
          ts: Date.parse(p.bucket),
          value: metric.kind === 'distance' ? u.distance(v) : v,
        };
      }),
    [points, metric, u],
  );
  const bands: TraceBand[] = useMemo(
    () =>
      props.bands.map((b) => ({
        from: b.from,
        to: b.to,
        fill: BAND[b.kind].fill,
        label: BAND[b.kind].label,
      })),
    [props.bands],
  );
  const kinds = new Set(props.bands.map((b) => b.kind));
  const unit = metric.kind === 'distance' ? u.distanceUnit : '%';

  return (
    <Panel
      title="Timeline"
      action={
        <Segmented
          label="Metric"
          options={METRICS.map((m, i) => ({ value: i, label: m.label }))}
          value={metricIdx}
          onChange={setMetricIdx}
        />
      }
    >
      <ContentFrame
        height={260}
        loading={isPending}
        stale={props.stale || isPlaceholderData}
        empty={data.length === 0 && props.segments.length === 0}
        emptyText="No history yet. Data appears as the vehicle reports its state."
      >
        <div className="pt-2">
          <TimeTrace
            from={from.getTime()}
            to={to.getTime()}
            points={data}
            domain={metric.key === 'battery' ? [0, 100] : undefined}
            unit={unit}
            digits={metric.kind === 'percent' || metric.key === 'mileage' ? 0 : 1}
            label={metric.label}
            bands={bands}
            height={236}
            axis
            onHover={props.onHover}
          />
        </div>
      </ContentFrame>
      <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-(--text-muted)">
        <li className="flex items-center gap-1.5">
          <span className="h-0.5 w-3.5 rounded-full bg-(--accent)" />
          {metric.label} ({unit})
        </li>
        {(Object.keys(BAND) as ActivityBand['kind'][])
          .filter((k) => kinds.has(k))
          .map((k) => (
            <li key={k} className="flex items-center gap-1.5">
              <span className="h-3 w-3.5 rounded-[3px]" style={{ background: BAND[k].swatch }} />
              {BAND[k].label}
            </li>
          ))}
      </ul>

      {props.segments.length > 0 && (
        <PanelSection title="Vehicle state">
          <StateStrip
            segments={props.segments}
            from={from.getTime()}
            to={to.getTime()}
            gutter
            onHover={props.onHover}
          />
        </PanelSection>
      )}
    </Panel>
  );
}
