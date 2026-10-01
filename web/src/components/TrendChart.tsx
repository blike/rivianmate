import { useId } from "react";
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
  /** "area" (default), "line" or "bar". */
  mark?: "area" | "line" | "bar";
  /** Put the series on a second Y axis on the right. */
  right?: boolean;
  unit?: string;
  digits?: number;
}

type Row = Record<string, number | null>;

/** Small chart shared by drive, charging and health views. */
export function TrendChart(props: {
  data: Row[];
  xKey: string;
  series: TrendSeries[];
  xFormatter?: (x: number) => string;
  tooltipLabel?: (x: number) => string;
  xType?: "number" | "category";
  leftDomain?: [number | "auto", number | "auto"];
  rightDomain?: [number | "auto", number | "auto"];
  height?: number;
}) {
  const gradientId = useId().replace(/:/g, "");
  const hasRight = props.series.some((s) => s.right);
  const tick = { fill: "var(--text-muted)", fontSize: 11 };
  const xFormatter = props.xFormatter ?? ((x: number) => fmt(x, 0));

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
            width={44}
            tickFormatter={(v: number) => fmt(v, 0)}
          />
          {hasRight && (
            <YAxis
              yAxisId="right"
              orientation="right"
              domain={props.rightDomain ?? ["auto", "auto"]}
              tick={tick}
              tickLine={false}
              axisLine={false}
              width={40}
              tickFormatter={(v: number) => fmt(v, 0)}
            />
          )}
          <Tooltip
            contentStyle={{
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderRadius: "0.5rem",
              color: "var(--text-primary)",
              fontSize: 12,
            }}
            labelFormatter={(x: number) => (props.tooltipLabel ?? xFormatter)(x)}
            formatter={(value: number, _name, item) => {
              const s = props.series.find((x) => x.key === item.dataKey);
              return [`${fmt(value, s?.digits ?? 1)}${s?.unit ? ` ${s.unit}` : ""}`, s?.label ?? ""];
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
            if (s.mark === "bar") return <Bar {...common} fill={s.color} radius={[3, 3, 0, 0]} />;
            if (s.mark === "line") {
              return <Line {...common} type="monotone" stroke={s.color} strokeWidth={2} dot={false} connectNulls />;
            }
            return (
              <Area
                {...common}
                type="monotone"
                stroke={s.color}
                strokeWidth={2}
                fill={`url(#${gradientId}-${s.key})`}
                dot={false}
                connectNulls
              />
            );
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
