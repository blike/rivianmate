import { useId, type ReactNode } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmt } from "../lib/state.js";

export interface TrendSeries {
  key: string;
  label: string;
  color: string;
  /** "area" (default), "line", "bar", or "dots" (a dot per point, unjoined). */
  mark?: "area" | "line" | "bar" | "dots";
  /** Bars sharing a stack id are drawn stacked. */
  stack?: string;
  /** Put the series on a second Y axis on the right. */
  right?: boolean;
  unit?: string;
  digits?: number;
  /** Draw a dot per data point (for sparse series). */
  dots?: boolean;
  /** Dashed, for estimates rather than readings (lines only). */
  dashed?: boolean;
  interpolation?: "linear" | "monotone";
  connectNulls?: boolean;
}

type Row = Record<string, number | null>;

/** Small chart shared by drive, charging and health views. */
export function TrendChart(props: {
  data: Row[];
  xKey: string;
  series: TrendSeries[];
  xFormatter?: (x: number) => string;
  tooltipLabel?: (x: number) => ReactNode;
  xType?: "number" | "category";
  leftDomain?: [number | "auto", number | "auto"];
  rightDomain?: [number | "auto", number | "auto"];
  leftUnit?: string;
  rightUnit?: string;
  height?: number;
}) {
  const gradientId = useId().replace(/:/g, "");
  const hasRight = props.series.some((s) => s.right);
  const tick = { fill: "var(--text-muted)", fontSize: 11 };
  const xFormatter = props.xFormatter ?? ((x: number) => fmt(x, 0));
  // Axis ticks use the series' precision so narrow ranges don't repeat labels.
  const leftDigits = props.series.find((s) => !s.right)?.digits ?? 0;
  const rightDigits = props.series.find((s) => s.right)?.digits ?? 0;

  return (
    <div style={{ height: props.height ?? 220 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={props.data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
            type={props.xType ?? "number"}
            domain={["dataMin", "dataMax"]}
            tick={tick}
            tickLine={false}
            axisLine={false}
            tickFormatter={xFormatter}
            minTickGap={32}
          />
          <YAxis
            yAxisId="left"
            domain={props.leftDomain ?? ["auto", "auto"]}
            tick={tick}
            tickLine={false}
            axisLine={false}
            width={props.leftUnit ? 64 : 44}
            tickFormatter={(v: number) => `${fmt(v, props.leftUnit && Number.isInteger(v) ? 0 : leftDigits)}${props.leftUnit ? ` ${props.leftUnit}` : ""}`}
          />
          {hasRight && (
            <YAxis
              yAxisId="right"
              orientation="right"
              domain={props.rightDomain ?? ["auto", "auto"]}
              tick={tick}
              tickLine={false}
              axisLine={false}
              width={props.rightUnit ? 52 : 40}
              tickFormatter={(v: number) => `${fmt(v, rightDigits)}${props.rightUnit ? ` ${props.rightUnit}` : ""}`}
            />
          )}
          <Tooltip
            cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              // One row per series, in declared order, skipping gaps.
              const rows = props.series.flatMap((s) => {
                const value = payload.find((p) => p.dataKey === s.key)?.value;
                return typeof value === "number" ? [{ s, value }] : [];
              });
              if (rows.length === 0) return null;
              return (
                <div className="min-w-[10rem] rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs shadow-lg">
                  <div className="text-[var(--text-primary)]">
                    {(props.tooltipLabel ?? xFormatter)(Number(label))}
                  </div>
                  <div className="mt-2 space-y-1 border-t border-[var(--border)] pt-2">
                    {rows.map(({ s, value }) => (
                      <div key={s.key} className="flex items-center gap-2">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
                        <span className="text-[var(--text-secondary)]">{s.label}</span>
                        <span className="ml-auto pl-4 font-medium tabular-nums text-[var(--text-primary)]">
                          {fmt(value, s.digits ?? 1)}
                          {s.unit && <span className="ml-0.5 font-normal text-[var(--text-muted)]">{s.unit}</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            }}
          />
          {props.series.length > 1 && (
            <Legend wrapperStyle={{ fontSize: 12, color: "var(--text-secondary)" }} />
          )}
          {props.series.map((s) => {
            const common = {
              key: s.key,
              dataKey: s.key,
              name: s.label,
              yAxisId: s.right ? "right" : "left",
              isAnimationActive: false,
            };
            if (s.mark === "bar") {
              return <Bar {...common} fill={s.color} stackId={s.stack} radius={s.stack ? 0 : [3, 3, 0, 0]} />;
            }
            if (s.mark === "dots") {
              return (
                <Line
                  {...common}
                  // Coloured for the legend, but zero width: points aren't joined.
                  stroke={s.color}
                  strokeWidth={0}
                  dot={{ r: 2.5, fill: s.color, fillOpacity: 0.75, strokeWidth: 0 }}
                  activeDot={{ r: 4, fill: s.color, strokeWidth: 0 }}
                  connectNulls={false}
                  legendType="circle"
                />
              );
            }
            if (s.mark === "line") {
              return (
                <Line
                  {...common}
                  type={s.interpolation ?? "monotone"}
                  stroke={s.color}
                  strokeWidth={2}
                  strokeDasharray={s.dashed ? "5 4" : undefined}
                  dot={s.dots ? { r: 3, fill: s.color, strokeWidth: 0 } : false}
                  connectNulls={s.connectNulls ?? true}
                />
              );
            }
            return (
              <Area
                {...common}
                type={s.interpolation ?? "monotone"}
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
