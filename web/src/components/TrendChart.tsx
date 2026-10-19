import { useId, type ReactNode } from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fmt } from '../lib/state';

export interface TrendSeries {
  key: string;
  label: string;
  color: string;
  /** "area" (default), "line" or "bar". */
  mark?: 'area' | 'line' | 'bar';
  /** Put the series on a second Y axis on the right. */
  right?: boolean;
  /** Scale the series on its own hidden axis; its values show in the tooltip. */
  ownScale?: boolean;
  unit?: string;
  digits?: number;
  /** Draw a dot per data point (for sparse series). */
  dots?: boolean;
  /** Dashed, for estimates rather than readings (lines only). */
  dashed?: boolean;
  interpolation?: 'linear' | 'monotone';
  connectNulls?: boolean;
}

/** A labelled horizontal line at a fixed value, e.g. a limit. */
export interface TrendReference {
  y: number;
  label: string;
  color: string;
  /** Against the right Y axis rather than the left. */
  right?: boolean;
}

type Row = Record<string, number | null>;

/** Small chart shared by drive, charging and health views. */
export function TrendChart(props: {
  data: Row[];
  xKey: string;
  series: TrendSeries[];
  xFormatter?: (x: number) => string;
  tooltipLabel?: (x: number) => ReactNode;
  xType?: 'number' | 'category';
  /** Exact x-axis tick positions; chosen automatically when left out. */
  xTicks?: number[];
  /** Label every (n + 1)th category, even where labels would sit close; thinned to fit when left out. */
  xInterval?: number;
  leftDomain?: [number | 'auto', number | 'auto'];
  rightDomain?: [number | 'auto', number | 'auto'];
  leftUnit?: string;
  rightUnit?: string;
  height?: number;
  references?: TrendReference[];
  /** Index into `data` of the point under the pointer; null when it leaves. */
  onHover?: (index: number | null) => void;
}) {
  const gradientId = useId().replace(/:/g, '');
  const hasRight = props.series.some((s) => s.right && !s.ownScale);
  const axisOf = (s: TrendSeries) => (s.ownScale ? `own-${s.key}` : s.right ? 'right' : 'left');
  const tick = { fill: 'var(--text-muted)', fontSize: 11 };
  const xFormatter = props.xFormatter ?? ((x: number) => fmt(x, 0));
  // Axis ticks use the series' precision so narrow ranges don't repeat labels.
  const leftDigits = props.series.find((s) => !s.right && !s.ownScale)?.digits ?? 0;
  const rightDigits = props.series.find((s) => s.right && !s.ownScale)?.digits ?? 0;

  return (
    <div style={{ height: props.height ?? 220 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={props.data}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          onMouseMove={
            props.onHover &&
            ((state) => {
              const index = Number(state.activeTooltipIndex);
              props.onHover?.(state.isTooltipActive && Number.isInteger(index) ? index : null);
            })
          }
          onMouseLeave={props.onHover && (() => props.onHover?.(null))}
        >
          <defs>
            {props.series.map((s) => (
              <linearGradient key={s.key} id={`${gradientId}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey={props.xKey}
            type={props.xType ?? 'number'}
            domain={['dataMin', 'dataMax']}
            tick={tick}
            tickLine={false}
            axisLine={false}
            tickFormatter={xFormatter}
            ticks={props.xTicks}
            interval={props.xInterval ?? 'preserveEnd'}
            minTickGap={32}
          />
          <YAxis
            yAxisId="left"
            domain={props.leftDomain ?? ['auto', 'auto']}
            tick={tick}
            tickLine={false}
            axisLine={false}
            width={props.leftUnit ? 64 : 44}
            tickFormatter={(v: number) =>
              `${fmt(v, props.leftUnit && Number.isInteger(v) ? 0 : leftDigits)}${props.leftUnit ? ` ${props.leftUnit}` : ''}`
            }
          />
          {hasRight && (
            <YAxis
              yAxisId="right"
              orientation="right"
              domain={props.rightDomain ?? ['auto', 'auto']}
              tick={tick}
              tickLine={false}
              axisLine={false}
              width={props.rightUnit ? 52 : 40}
              tickFormatter={(v: number) =>
                `${fmt(v, rightDigits)}${props.rightUnit ? ` ${props.rightUnit}` : ''}`
              }
            />
          )}
          {props.series
            .filter((s) => s.ownScale)
            .map((s) => (
              <YAxis key={s.key} yAxisId={axisOf(s)} domain={['auto', 'auto']} hide />
            ))}
          <Tooltip
            cursor={{ stroke: 'var(--border)', strokeWidth: 1 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              // One row per series, in declared order, skipping gaps.
              const rows = props.series.flatMap((s) => {
                const value = payload.find((p) => p.dataKey === s.key)?.value;
                return typeof value === 'number' ? [{ s, value }] : [];
              });
              if (rows.length === 0) return null;
              return (
                <div className="min-w-40 rounded-lg border border-(--border) bg-(--surface-2) px-3 py-2 text-xs shadow-lg">
                  <div className="text-(--text-primary)">
                    {(props.tooltipLabel ?? xFormatter)(Number(label))}
                  </div>
                  <div className="mt-2 space-y-1 border-t border-(--border) pt-2">
                    {rows.map(({ s, value }) => (
                      <div key={s.key} className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: s.color }}
                        />
                        <span className="text-(--text-secondary)">{s.label}</span>
                        <span className="ml-auto pl-4 font-medium tabular-nums text-(--text-primary)">
                          {fmt(value, s.digits ?? 1)}
                          {s.unit && (
                            <span className="ml-0.5 font-normal text-(--text-muted)">{s.unit}</span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            }}
          />
          {props.references?.map((r) => (
            <ReferenceLine
              key={r.label}
              y={r.y}
              yAxisId={r.right ? 'right' : 'left'}
              stroke={r.color}
              strokeDasharray="4 4"
              strokeOpacity={0.8}
              ifOverflow="extendDomain"
              label={{
                value: r.label,
                position: 'insideTopLeft',
                fill: 'var(--text-muted)',
                fontSize: 11,
              }}
            />
          ))}
          {props.series.length > 1 && (
            <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text-secondary)' }} />
          )}
          {props.series.map((s) => {
            const common = {
              key: s.key,
              dataKey: s.key,
              name: s.label,
              yAxisId: axisOf(s),
              isAnimationActive: false,
            };
            if (s.mark === 'bar') return <Bar {...common} fill={s.color} radius={[3, 3, 0, 0]} />;
            if (s.mark === 'line') {
              return (
                <Line
                  {...common}
                  type={s.interpolation ?? 'monotone'}
                  stroke={s.color}
                  strokeWidth={2}
                  strokeDasharray={s.dashed ? '5 4' : undefined}
                  dot={s.dots ? { r: 3, fill: s.color, strokeWidth: 0 } : false}
                  connectNulls={s.connectNulls ?? true}
                />
              );
            }
            return (
              <Area
                {...common}
                type={s.interpolation ?? 'monotone'}
                stroke={s.color}
                strokeWidth={2}
                fill={`url(#${gradientId}-${s.key})`}
                dot={false}
                connectNulls={s.connectNulls ?? true}
              />
            );
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
