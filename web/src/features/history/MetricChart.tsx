import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../../api/client';
import { useUnits } from '../../api/hooks';
import { ContentFrame } from '../../components/LoadingState';
import { dateTime } from '../../lib/format';
import { fmt } from '../../lib/state';
import { type ActivityKind, activityBands } from './history';
import { RANGES, METRICS } from './options';
import { timeTicks } from './timeAxis';

/** Plugged in but not charging is striped, so it reads apart from charging. */
const BAND: Record<ActivityKind, { label: string; fill: string; opacity: number; swatch: string }> =
  {
    drive: {
      label: 'Driving',
      fill: 'var(--series-1)',
      opacity: 0.2,
      swatch: 'color-mix(in srgb, var(--series-1) 55%, transparent)',
    },
    charging: {
      label: 'Charging',
      fill: 'var(--status-good)',
      opacity: 0.28,
      swatch: 'color-mix(in srgb, var(--status-good) 65%, transparent)',
    },
    plugged: {
      label: 'Plugged in',
      fill: 'url(#history-plugged)',
      opacity: 1,
      swatch:
        'repeating-linear-gradient(135deg, color-mix(in srgb, var(--status-good) 70%, transparent) 0 1.5px, transparent 1.5px 4px)',
    },
  };

/** The chosen metric over the period, with drives and charging shaded behind it. */
export function MetricChart(props: {
  vehicleId: string;
  metric: (typeof METRICS)[number];
  range: (typeof RANGES)[number];
  from: Date;
  to: Date;
  bands: ReturnType<typeof activityBands>;
  /** The time under the pointer; null when it leaves. */
  onHover?: (ts: number | null) => void;
}) {
  const { metric, range, from, to } = props;
  const u = useUnits();
  const unit = metric.kind === 'distance' ? u.distanceUnit : '%';

  const { data: points, isPending } = useQuery({
    queryKey: ['history', props.vehicleId, metric.key, range.label],
    queryFn: () => api.history(props.vehicleId, metric.key, from, to, range.bucket),
    refetchInterval: 60_000,
    // Keep the old chart while a new range loads; another metric's values
    // would be drawn on the wrong scale, so those show a placeholder instead.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === metric.key ? previous : undefined,
  });

  const convert = useCallback(
    (v: number | null): number | null => {
      if (v == null) return null;
      const scaled = v * (metric.scale ?? 1);
      if (metric.kind === 'distance') return u.distance(scaled);
      return scaled;
    },
    [metric, u],
  );
  const data = useMemo(
    () => (points ?? []).map((p) => ({ ts: new Date(p.bucket).getTime(), value: convert(p.avg) })),
    [points, convert],
  );
  // The whole window, so shaded activity lines up with the period chosen.
  const axis = useMemo(() => timeTicks(from.getTime(), to.getTime()), [from, to]);
  const kinds = new Set(props.bands.map((b) => b.kind));
  const digits = metric.kind === 'percent' || metric.key === 'mileage' ? 0 : 1;

  return (
    <>
      <ContentFrame
        height="18rem"
        loading={isPending}
        empty={data.length === 0}
        emptyText="No history yet. Data appears as the vehicle reports its state."
      >
        <div style={{ height: '18rem' }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data}
              margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
              onMouseMove={(state) => {
                const ts = data[Number(state.activeTooltipIndex)]?.ts;
                props.onHover?.(state.isTooltipActive && ts != null ? ts : null);
              }}
              onMouseLeave={() => props.onHover?.(null)}
            >
              <defs>
                <pattern
                  id="history-plugged"
                  width="6"
                  height="6"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <rect width="6" height="6" fill="var(--status-good)" fillOpacity={0.06} />
                  <rect width="1.5" height="6" fill="var(--status-good)" fillOpacity={0.35} />
                </pattern>
                <linearGradient id="history-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              {props.bands.map((b) => (
                <ReferenceArea
                  key={`${b.kind}-${b.from}`}
                  x1={b.from}
                  x2={Math.max(b.to, b.from + (to.getTime() - from.getTime()) / 400)}
                  fill={BAND[b.kind].fill}
                  fillOpacity={BAND[b.kind].opacity}
                  strokeOpacity={0}
                  ifOverflow="hidden"
                />
              ))}
              <XAxis
                dataKey="ts"
                type="number"
                domain={[from.getTime(), to.getTime()]}
                scale="time"
                ticks={axis.ticks}
                tickFormatter={axis.format}
                minTickGap={24}
                tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                domain={metric.key === 'battery' ? [0, 100] : ['auto', 'auto']}
                tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={48}
                tickFormatter={(v: number) => fmt(v, 0)}
              />
              <Tooltip
                cursor={{ stroke: 'var(--border)', strokeWidth: 1 }}
                content={({ active, payload, label }) => {
                  const value = payload?.[0]?.value;
                  if (!active || typeof value !== 'number') return null;
                  const ts = Number(label);
                  const during =
                    props.bands.find((b) => b.kind === 'drive' && ts >= b.from && ts <= b.to) ??
                    props.bands.find((b) => ts >= b.from && ts <= b.to);
                  return (
                    <div className="min-w-36 rounded-lg border border-(--border) bg-(--surface-2) px-3 py-2 text-xs shadow-lg">
                      <div className="text-(--text-primary)">{dateTime(ts)}</div>
                      <div className="mt-2 flex items-center gap-2 border-t border-(--border) pt-2">
                        <span className="text-(--text-secondary)">{metric.label}</span>
                        <span className="ml-auto pl-4 font-medium tabular-nums text-(--text-primary)">
                          {fmt(value, digits)}
                          <span className="ml-0.5 font-normal text-(--text-muted)">{unit}</span>
                        </span>
                      </div>
                      {during && (
                        <div className="mt-1 flex items-center gap-2 text-(--text-secondary)">
                          <span
                            className="h-2 w-2 rounded-sm"
                            style={{ background: BAND[during.kind].swatch }}
                          />
                          {BAND[during.kind].label}
                        </div>
                      )}
                    </div>
                  );
                }}
              />
              <Area
                type="linear"
                dataKey="value"
                stroke="var(--accent)"
                strokeWidth={2}
                fill="url(#history-fill)"
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </ContentFrame>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-(--text-muted)">
        <li className="flex items-center gap-1.5">
          <span className="h-0.5 w-3 rounded-full bg-(--accent)" />
          {metric.label} ({unit})
        </li>
        {(['drive', 'charging', 'plugged'] as const)
          .filter((k) => kinds.has(k))
          .map((k) => (
            <li key={k} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: BAND[k].swatch }} />
              {BAND[k].label}
            </li>
          ))}
      </ul>
    </>
  );
}
