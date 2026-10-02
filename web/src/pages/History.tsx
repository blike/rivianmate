import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { HistoryMetric } from "@server/api-types.js";
import { api } from "../api/client.js";
import { useUnits } from "../api/hooks.js";
import { ContentFrame } from "../components/loading.js";
import { Panel } from "../components/panels.js";
import { VehicleMap } from "../components/VehicleMap.js";
import { fmt } from "../lib/state.js";
import { timeTicks } from "../lib/timeAxis.js";

const RANGES = [
  { label: "24h", title: "24 hours", hours: 24, bucket: "15m" },
  { label: "7d", title: "7 days", hours: 24 * 7, bucket: "1h" },
  { label: "30d", title: "30 days", hours: 24 * 30, bucket: "6h" },
  { label: "90d", title: "90 days", hours: 24 * 90, bucket: "1d" },
] as const;

type MetricKind = "percent" | "distance" | "temperature";

/** Raw values: range in km, odometer in metres, temperature in °C. */
const METRICS: { key: HistoryMetric; label: string; kind: MetricKind; scale?: number }[] = [
  { key: "battery", label: "Battery", kind: "percent" },
  { key: "range", label: "Range", kind: "distance" },
  { key: "mileage", label: "Odometer", kind: "distance", scale: 1 / 1000 },
  { key: "cabinTemp", label: "Cabin temp", kind: "temperature" },
];

export function History(props: { vehicleId: string }) {
  const [rangeIdx, setRangeIdx] = useState(1);
  const [metricIdx, setMetricIdx] = useState(0);
  const range = RANGES[rangeIdx] ?? RANGES[1]!;
  const metric = METRICS[metricIdx] ?? METRICS[0]!;
  const u = useUnits();
  const unit =
    metric.kind === "distance"
      ? u.distanceUnit
      : metric.kind === "temperature"
        ? u.temperatureUnit
        : "%";

  const { from, to } = useMemo(() => {
    const to = new Date();
    return { from: new Date(to.getTime() - range.hours * 3600_000), to };
  }, [range.hours]);

  const { data: points, isPending: pointsPending } = useQuery({
    queryKey: ["history", props.vehicleId, metric.key, range.label],
    queryFn: () => api.history(props.vehicleId, metric.key, from, to, range.bucket),
    refetchInterval: 60_000,
    // Keep the old chart while a new range loads; another metric's values
    // would be drawn on the wrong scale, so those show a placeholder instead.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === metric.key ? previous : undefined,
  });

  const { data: trail, isPending: trailPending } = useQuery({
    queryKey: ["locations", props.vehicleId, range.label],
    queryFn: () => api.locations(props.vehicleId, from, to),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });

  const convert = useCallback(
    (v: number | null): number | null => {
      if (v == null) return null;
      const scaled = v * (metric.scale ?? 1);
      if (metric.kind === "distance") return u.distance(scaled);
      if (metric.kind === "temperature") return u.temperature(scaled);
      return scaled;
    },
    [metric, u],
  );

  const chartData = useMemo(
    () =>
      (points ?? []).map((p) => ({
        ts: new Date(p.bucket).getTime(),
        value: convert(p.avg),
      })),
    [points, convert],
  );

  // Ticks follow the data's own span: a week's window with a day of data
  // gets hourly ticks, not the same date repeated.
  const axis = useMemo(
    () => timeTicks(chartData[0]?.ts ?? 0, chartData.at(-1)?.ts ?? 0),
    [chartData],
  );

  const trailPositions = useMemo(
    () => (trail ?? []).map((p) => [p.lat, p.lon] as [number, number]),
    [trail],
  );
  const lastPosition = trailPositions.at(-1);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-[var(--border)] p-0.5">
          {METRICS.map((m, i) => (
            <FilterButton key={m.key} active={i === metricIdx} onClick={() => setMetricIdx(i)}>
              {m.label}
            </FilterButton>
          ))}
        </div>
        <div className="flex rounded-md border border-[var(--border)] p-0.5">
          {RANGES.map((r, i) => (
            <FilterButton key={r.label} active={i === rangeIdx} onClick={() => setRangeIdx(i)}>
              {r.label}
            </FilterButton>
          ))}
        </div>
      </div>

      <Panel title={`${metric.label} (${unit}) — last ${range.title}`}>
        <ContentFrame
          height="18rem"
          loading={pointsPending}
          empty={chartData.length === 0}
          emptyText="No history yet — data appears as the vehicle reports state."
        >
          <div style={{ height: "18rem" }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
                <XAxis
                  dataKey="ts"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  scale="time"
                  ticks={axis.ticks}
                  tickFormatter={axis.format}
                  minTickGap={24}
                  stroke="var(--text-muted)"
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                />
                <YAxis
                  domain={metric.key === "battery" ? [0, 100] : ["auto", "auto"]}
                  stroke="var(--text-muted)"
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  width={44}
                  tickFormatter={(v: number) => fmt(v, 0)}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--surface-2)",
                    border: "1px solid var(--border)",
                    borderRadius: "0.5rem",
                    color: "var(--text-primary)",
                    fontSize: 12,
                  }}
                  labelFormatter={(ts) => new Date(Number(ts)).toLocaleString()}
                  formatter={(value) => [
                    `${fmt(typeof value === "number" ? value : null, 1)} ${unit}`,
                    metric.label,
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="var(--series-1)"
                  strokeWidth={2}
                  fill="url(#fill)"
                  dot={false}
                  connectNulls
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </ContentFrame>
      </Panel>

      <Panel title="Location trail">
        <ContentFrame
          height="24rem"
          loading={trailPending}
          empty={trailPositions.length === 0}
          emptyText="No location points in this range."
        >
          {lastPosition && (
            <VehicleMap
              lat={lastPosition[0]}
              lon={lastPosition[1]}
              trail={trailPositions}
              height="24rem"
              follow={false}
            />
          )}
        </ContentFrame>
      </Panel>
    </div>
  );
}

function FilterButton(props: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={props.onClick}
      className={`rounded px-2.5 py-1 text-xs ${
        props.active
          ? "bg-[var(--surface-2)] text-[var(--text-primary)]"
          : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      }`}
    >
      {props.children}
    </button>
  );
}
