import { useId, useState, type ReactNode } from 'react';
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
  /** "area" (default), "line" or "bar". A band ignores this. */
  mark?: 'area' | 'line' | 'bar';
  /** Put the series on a second Y axis on the right. */
  right?: boolean;
  /**
   * Scale the series on its own hidden axis; its values show in the tooltip.
   * A name instead of `true` lets several series share one scale.
   */
  ownScale?: boolean | string;
  /**
   * Draw as a min–max band: the row's value for the key is a `[min, max]` pair,
   * or null where nothing was read. The band never spans a null, so it breaks
   * with the line rather than filling a silence nothing was recorded in.
   */
  band?: boolean;
  /**
   * A value the tooltip names with nothing of its own drawn, such as the ends of
   * a band: it is read off the same row the band is drawn from.
   */
  tooltipOnly?: boolean;
  /** Layering among the marks; a lower one draws beneath the rest. */
  zIndex?: number;
  unit?: string;
  digits?: number;
  /** Draw a dot per data point (for sparse series). */
  dots?: boolean;
  /** Dashed, for estimates rather than readings (lines only). */
  dashed?: boolean;
  interpolation?: 'linear' | 'monotone';
  connectNulls?: boolean;
  /**
   * Drawn, but left out of the tooltip and legend — context for what is read,
   * like the band around a reading, rather than a reading of its own.
   */
  quiet?: boolean;
}

/** A labelled horizontal line at a fixed value, e.g. a limit. */
export interface TrendReference {
  y: number;
  label: string;
  color: string;
  /** Against the right Y axis rather than the left. */
  right?: boolean;
}

/** A series' value under the pointer: a reading, or a band's two ends. */
type TooltipValue = number | [number, number];

/** A value in the series' precision; a band as "min–max". */
const valueText = (series: TrendSeries, value: TooltipValue): string =>
  Array.isArray(value)
    ? `${fmt(value[0], series.digits ?? 0)}–${fmt(value[1], series.digits ?? 0)}`
    : fmt(value, series.digits ?? 1);

/** A chart row: readings, a band's `[min, max]`, and null where there's none. */
type Row = Record<string, number | [number, number] | null>;

/** A series and what it read under the pointer. */
export interface TooltipRow {
  series: TrendSeries;
  value: TooltipValue;
}

/** The axis a series is drawn against; one on a scale of its own gets its own. */
const ownAxisId = (scale: string) => `own-${scale}`;
const ownScaleOf = (s: TrendSeries) => (typeof s.ownScale === 'string' ? s.ownScale : s.key);
const axisOf = (s: TrendSeries) =>
  s.ownScale ? ownAxisId(ownScaleOf(s)) : s.right ? 'right' : 'left';

/**
 * What one point of the chart explains: a row per series, in the order they were
 * declared, skipping the ones with nothing to read there. Each value is read off
 * the row itself, so a series the tooltip names without drawing is listed the
 * same as one with a mark. A quiet series is context and stays unexplained, and
 * an estimate is left out where a reading on its axis says the same thing, e.g.
 * where a forecast joins the recorded curve.
 */
export function tooltipRows(series: readonly TrendSeries[], row: Row): TooltipRow[] {
  const valueOf = (s: TrendSeries): TooltipValue | null => {
    const value = row[s.key];
    if (typeof value === 'number') return value;
    // A band's two ends.
    if (Array.isArray(value) && value.every((v) => typeof v === 'number')) {
      return [value[0]!, value[1]!];
    }
    return null;
  };
  const shown = series.filter((s) => !s.quiet);
  return shown.flatMap((s) => {
    const value = valueOf(s);
    if (value == null) return [];
    const read = (o: TrendSeries) =>
      !o.tooltipOnly && !o.dashed && axisOf(o) === axisOf(s) && valueOf(o) != null;
    if (s.dashed && shown.some(read)) return [];
    return [{ series: s, value }];
  });
}

/** The tooltip: the moment under the pointer, then a row per series with its value. */
export function TrendTooltip(props: { title: ReactNode; rows: TooltipRow[] }) {
  return (
    <div className="min-w-40 rounded-lg border border-(--border) bg-(--surface-2) px-3 py-2 text-xs shadow-lg">
      <div className="text-(--text-primary)">{props.title}</div>
      <div className="mt-2 space-y-1 border-t border-(--border) pt-2">
        {props.rows.map(({ series, value }) => (
          <div key={series.key} className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: series.color }} />
            <span className="text-(--text-secondary)">{series.label}</span>
            <span className="ml-auto pl-4 font-medium tabular-nums text-(--text-primary)">
              {valueText(series, value)}
              {series.unit && (
                <span className="ml-0.5 font-normal text-(--text-muted)">{series.unit}</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

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
  /**
   * The values the left axis is ticked at, where the chart should not pick them.
   * A number axis is given a spacing only as the list of values it falls on:
   * recharts' own `interval` counts ticks rather than adding to their values.
   * Every one of them is labelled — the chart thinning them is what leaves a
   * regular spacing reading as an irregular set of numbers.
   */
  leftTicks?: readonly number[];
  rightDomain?: [number | 'auto', number | 'auto'];
  /**
   * Bounds for a scale drawn on its own hidden axis, by the name it is shared
   * under: a scale wider than its readings keeps the picture the same size from
   * chart to chart.
   */
  ownDomains?: Record<string, [number | 'auto', number | 'auto']>;
  leftUnit?: string;
  rightUnit?: string;
  height?: number;
  references?: TrendReference[];
  /** Index into `data` of the point under the pointer; null when it leaves. */
  onHover?: (index: number | null) => void;
  /** Charts with the same id and data share the pointer. */
  syncId?: string;
  /** A fixed width for the left axis, so stacked charts line up. */
  yAxisWidth?: number;
  /** Leave the x axis to a chart stacked beneath. */
  hideXAxis?: boolean;
}) {
  const gradientId = useId().replace(/:/g, '');
  // Synced charts all follow the pointer, but only the one under it explains.
  const [pointerIn, setPointerIn] = useState(false);
  const shown = props.series.filter((s) => !s.quiet);
  // A series the tooltip names without drawing needs no axis under it.
  const plotted = props.series.filter((s) => !s.tooltipOnly);
  const hasRight = plotted.some((s) => s.right && !s.ownScale);
  // One hidden axis per scale, however many series are drawn against it.
  const ownScales = [...new Set(plotted.flatMap((s) => (s.ownScale ? [ownScaleOf(s)] : [])))];
  const tick = { fill: 'var(--text-muted)', fontSize: 11 };
  const xFormatter = props.xFormatter ?? ((x: number) => fmt(x, 0));
  // Axis ticks use the series' precision so narrow ranges don't repeat labels.
  const leftDigits = plotted.find((s) => !s.right && !s.ownScale)?.digits ?? 0;
  const rightDigits = plotted.find((s) => s.right && !s.ownScale)?.digits ?? 0;

  return (
    <div
      style={{ height: props.height ?? 220 }}
      onPointerEnter={props.syncId ? () => setPointerIn(true) : undefined}
      onPointerLeave={props.syncId ? () => setPointerIn(false) : undefined}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={props.data}
          syncId={props.syncId}
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
            {plotted.map((s) => (
              <linearGradient key={s.key} id={`${gradientId}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey={props.xKey}
            hide={props.hideXAxis}
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
            ticks={props.leftTicks ? [...props.leftTicks] : undefined}
            interval={props.leftTicks ? 0 : 'preserveEnd'}
            tick={tick}
            tickLine={false}
            axisLine={false}
            width={props.yAxisWidth ?? 'auto'}
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
              width="auto"
              tickFormatter={(v: number) =>
                `${fmt(v, rightDigits)}${props.rightUnit ? ` ${props.rightUnit}` : ''}`
              }
            />
          )}
          {ownScales.map((scale) => (
            <YAxis
              key={scale}
              yAxisId={ownAxisId(scale)}
              domain={props.ownDomains?.[scale] ?? ['auto', 'auto']}
              hide
            />
          ))}
          <Tooltip
            isAnimationActive={false}
            cursor={{ stroke: 'var(--border)', strokeWidth: 1 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length || (props.syncId && !pointerIn)) return null;
              // The row under the pointer, which every explained series is read off.
              const row = payload[0]?.payload as Row | undefined;
              if (!row) return null;
              const rows = tooltipRows(props.series, row);
              if (rows.length === 0) return null;
              return (
                <TrendTooltip
                  title={(props.tooltipLabel ?? xFormatter)(Number(label))}
                  rows={rows}
                />
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
          {shown.length > 1 && (
            <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text-secondary)' }} />
          )}
          {props.series.map((s) => {
            // A series the tooltip names has no mark of its own to draw.
            if (s.tooltipOnly) return null;
            const common = {
              key: s.key,
              dataKey: s.key,
              name: s.label,
              yAxisId: axisOf(s),
              isAnimationActive: false,
              ...(s.zIndex != null && { zIndex: s.zIndex }),
              ...(s.quiet && { legendType: 'none' as const }),
            };
            if (s.mark === 'bar') return <Bar {...common} fill={s.color} radius={[3, 3, 0, 0]} />;
            if (s.band) {
              return (
                <Area
                  {...common}
                  type={s.interpolation ?? 'monotone'}
                  stroke="none"
                  fill={s.color}
                  fillOpacity={0.18}
                  dot={false}
                  connectNulls={false}
                />
              );
            }
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
