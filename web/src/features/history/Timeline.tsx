import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api } from '../../api/client';
import { useUnits } from '../../api/hooks';
import { ContentFrame } from '../../components/LoadingState';
import { type TraceBand, TimeTrace } from '../../components/TimeTrace';
import { type ActivityBand, type StateSegment } from './history';
import { METRICS, RANGES } from './options';
import { Segmented } from './Segmented';
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

/**
 * The chosen metric over the period with drives and charging shaded behind
 * it, then the vehicle's state as a strip of its own; each with its legend.
 */
export function Timeline(props: {
  vehicleId: string;
  range: (typeof RANGES)[number];
  from: Date;
  to: Date;
  bands: ActivityBand[];
  segments: StateSegment[];
  onHover?: (ts: number | null) => void;
}) {
  const { range, from, to } = props;
  const u = useUnits();
  const [metricIdx, setMetricIdx] = useState(0);
  const metric = METRICS[metricIdx] ?? METRICS[0]!;

  const { data: points, isPending } = useQuery({
    queryKey: ['history', props.vehicleId, metric.key, range.label],
    queryFn: () => api.history(props.vehicleId, metric.key, from, to, range.bucket),
    refetchInterval: 60_000,
    // Keep the old line while a new range loads; another metric's values
    // would be drawn on the wrong scale, so those show a placeholder instead.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === metric.key ? previous : undefined,
  });

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
    <section className="card p-5 sm:p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <h2 className="eyebrow text-(--text-secondary)">Timeline</h2>
        <Segmented
          label="Metric"
          items={METRICS.map((m) => m.label)}
          value={metricIdx}
          onChange={setMetricIdx}
        />
      </div>
      <ContentFrame
        height={260}
        loading={isPending}
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
        <div className="mt-6 border-t border-(--hairline) pt-5">
          <h3 className="mb-3 text-xs uppercase tracking-wide text-(--text-muted)">
            Vehicle state
          </h3>
          <StateStrip
            segments={props.segments}
            from={from.getTime()}
            to={to.getTime()}
            gutter
            onHover={props.onHover}
          />
        </div>
      )}
    </section>
  );
}
