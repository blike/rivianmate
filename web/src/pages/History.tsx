import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { HistoryMetric } from "@server/api-types.js";
import { api } from "../api/client.js";
import { useUnits } from "../api/hooks.js";
import { ContentFrame, LoadingScope, Skeleton, useLoading } from "../components/loading.js";
import { Panel } from "../components/panels.js";
import { TrendChart } from "../components/TrendChart.js";
import { VehicleMap } from "../components/VehicleMap.js";
import { isPosition } from "../lib/geo.js";
import { type ActivityKind, activityBands, distanceByPeriod, periodSummary, positionAt } from "../lib/history.js";
import { formatMoney } from "../lib/charging.js";
import { fmt, fmtSeconds } from "../lib/state.js";
import { timeTicks } from "../lib/timeAxis.js";

const RANGES = [
  // Every reading where that stays light enough to draw; short averages beyond.
  { label: "24h", title: "24 hours", hours: 24, bucket: "raw" },
  { label: "7d", title: "7 days", hours: 24 * 7, bucket: "raw" },
  { label: "30d", title: "30 days", hours: 24 * 30, bucket: "5m" },
  { label: "90d", title: "90 days", hours: 24 * 90, bucket: "15m" },
] as const;

type MetricKind = "percent" | "distance";

/** Raw values: range in km, odometer in metres. */
const METRICS: { key: HistoryMetric; label: string; kind: MetricKind; scale?: number }[] = [
  { key: "battery", label: "Battery", kind: "percent" },
  { key: "range", label: "Range", kind: "distance" },
  { key: "mileage", label: "Odometer", kind: "distance", scale: 1 / 1000 },
];

/** Plugged in but not charging is striped, so it reads apart from charging. */
const BAND: Record<ActivityKind, { label: string; fill: string; opacity: number; swatch: string }> = {
  drive: {
    label: "Driving",
    fill: "var(--series-1)",
    opacity: 0.2,
    swatch: "color-mix(in srgb, var(--series-1) 55%, transparent)",
  },
  charging: {
    label: "Charging",
    fill: "var(--status-good)",
    opacity: 0.28,
    swatch: "color-mix(in srgb, var(--status-good) 65%, transparent)",
  },
  plugged: {
    label: "Plugged in",
    fill: "url(#history-plugged)",
    opacity: 1,
    swatch:
      "repeating-linear-gradient(135deg, color-mix(in srgb, var(--status-good) 70%, transparent) 0 1.5px, transparent 1.5px 4px)",
  },
};

/** "Oct 10, 12:53 PM": no seconds. */
const tooltipTime = (ms: number) =>
  new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function History(props: { vehicleId: string }) {
  const [rangeIdx, setRangeIdx] = useState(1);
  const [metricIdx, setMetricIdx] = useState(0);
  const range = RANGES[rangeIdx] ?? RANGES[1]!;
  const metric = METRICS[metricIdx] ?? METRICS[0]!;

  const { from, to } = useMemo(() => {
    const to = new Date();
    return { from: new Date(to.getTime() - range.hours * 3600_000), to };
  }, [range.hours]);

  const { data: drives, isPending: drivesPending } = useQuery({
    queryKey: ["drives", props.vehicleId],
    queryFn: () => api.drives(props.vehicleId),
    refetchInterval: 60_000,
  });
  const { data: sessions, isPending: sessionsPending } = useQuery({
    queryKey: ["chargingSessions", props.vehicleId],
    queryFn: () => api.chargingSessions(props.vehicleId),
    refetchInterval: 60_000,
  });
  const { data: spans, isPending: spansPending } = useQuery({
    queryKey: ["chargeSpans", props.vehicleId, range.label],
    queryFn: () => api.chargeSpans(props.vehicleId, from, to),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });

  const { data: trail, isPending: trailPending } = useQuery({
    queryKey: ["locations", props.vehicleId, range.label],
    queryFn: () => api.locations(props.vehicleId, from, to),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
  const fixes = useMemo(
    () => (trail ?? []).filter((p) => isPosition(p.lat, p.lon)).map((p) => ({ ts: Date.parse(p.ts), lat: p.lat, lon: p.lon })),
    [trail],
  );
  const trailPositions = useMemo(() => fixes.map((p) => [p.lat, p.lon] as [number, number]), [fixes]);
  const lastPosition = trailPositions.at(-1);
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
          <Segmented items={METRICS.map((m) => m.label)} value={metricIdx} onChange={setMetricIdx} />
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

      <Panel title="Location history">
        <ContentFrame
          height="24rem"
          loading={trailPending}
          empty={trailPositions.length === 0}
          emptyText="No location points in this period."
        >
          {lastPosition && (
            <VehicleMap
              lat={lastPosition[0]}
              lon={lastPosition[1]}
              trail={trailPositions}
              variant="history"
              height="24rem"
              follow={false}
              highlight={hoverPosition}
            />
          )}
        </ContentFrame>
      </Panel>
    </div>
  );
}

/** The period at a glance: distance up front, then what else happened. */
function SummaryCard(props: {
  range: (typeof RANGES)[number];
  rangeIdx: number;
  onRange: (i: number) => void;
  summary: ReturnType<typeof periodSummary>;
  activityPending: boolean;
}) {
  const u = useUnits();
  const s = props.summary;
  const tiles: { label: string; value: ReactNode; sub?: ReactNode; pending: boolean }[] = [
    {
      label: "Drives",
      value: fmt(s.drives, 0),
      sub: s.drives > 0 ? `${u.formatDistance(s.distanceKm / s.drives)} on average` : "None in this period",
      pending: props.activityPending,
    },
    {
      label: "Time driving",
      value: s.drivingSeconds > 0 ? fmtSeconds(s.drivingSeconds) : "—",
      sub: s.drivingSeconds > 0 ? `${u.formatSpeed(s.distanceKm / (s.drivingSeconds / 3600))} average` : undefined,
      pending: props.activityPending,
    },
    {
      label: "Efficiency",
      value: u.formatEfficiency(s.energyDistanceKm, s.energyKwh),
      sub: s.energyKwh > 0 ? `${fmt(s.energyKwh, 1)} kWh used` : undefined,
      pending: props.activityPending,
    },
    {
      label: "Charged",
      value: s.sessions > 0 ? `${fmt(s.chargedKwh, 1)} kWh` : "—",
      sub: s.sessions > 0 ? `${s.sessions} session${s.sessions === 1 ? "" : "s"}` : "No sessions",
      pending: props.activityPending,
    },
    {
      label: "Charging cost",
      value: s.cost != null ? `${s.costEstimated ? "≈ " : ""}${formatMoney(String(s.cost), s.currency)}` : "—",
      sub:
        s.cost != null && s.distanceKm > 0
          ? `${formatMoney(String(s.cost / (u.distance(s.distanceKm) ?? 1)), s.currency)} per ${u.distanceUnit}`
          : s.sessions > 0
            ? "Add costs on the Charging page"
            : undefined,
      pending: props.activityPending,
    },
  ];

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-4 p-5">
        <div>
          <div className="text-xs text-[var(--text-muted)]">Last {props.range.title}</div>
          <div className="mt-0.5 text-3xl font-semibold tabular-nums tracking-tight">
            <LoadingScope loading={props.activityPending}>
              <BigValue value={fmt(u.distance(s.distanceKm), 0)} unit={`${u.distanceUnit} driven`} />
            </LoadingScope>
          </div>
        </div>
        <Segmented items={RANGES.map((r) => r.label)} value={props.rangeIdx} onChange={props.onRange} />
      </div>
      <ul className="grid grid-cols-2 gap-px border-t border-[var(--border)] bg-[var(--border)] sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((t) => (
          <li key={t.label} className="bg-[var(--surface-1)] px-4 py-3 last:max-sm:col-span-2">
            <div className="text-xs text-[var(--text-muted)]">{t.label}</div>
            <div className="mt-1 text-base font-semibold tabular-nums">{t.pending ? <Skeleton className="w-[5em]" /> : t.value}</div>
            <div className="text-xs text-[var(--text-secondary)]">
              {t.pending ? <Skeleton className="w-[7em]" /> : (t.sub ?? " ")}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function BigValue(props: { value: string; unit: string }) {
  const loading = useLoading();
  if (loading) return <Skeleton className="w-[5em]" />;
  return (
    <>
      {props.value}
      <span className="ml-1.5 text-base font-normal text-[var(--text-muted)]">{props.unit}</span>
    </>
  );
}

/** The chosen metric over the period, with drives and charging shaded behind it. */
function MetricChart(props: {
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
  const unit = metric.kind === "distance" ? u.distanceUnit : "%";

  const { data: points, isPending } = useQuery({
    queryKey: ["history", props.vehicleId, metric.key, range.label],
    queryFn: () => api.history(props.vehicleId, metric.key, from, to, range.bucket),
    refetchInterval: 60_000,
    // Keep the old chart while a new range loads; another metric's values
    // would be drawn on the wrong scale, so those show a placeholder instead.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[2] === metric.key ? previous : undefined),
  });

  const convert = useCallback(
    (v: number | null): number | null => {
      if (v == null) return null;
      const scaled = v * (metric.scale ?? 1);
      if (metric.kind === "distance") return u.distance(scaled);
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
  const digits = metric.kind === "percent" || metric.key === "mileage" ? 0 : 1;

  return (
    <>
      <ContentFrame
        height="18rem"
        loading={isPending}
        empty={data.length === 0}
        emptyText="No history yet. Data appears as the vehicle reports its state."
      >
        <div style={{ height: "18rem" }}>
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
                <pattern id="history-plugged" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
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
                tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                domain={metric.key === "battery" ? [0, 100] : ["auto", "auto"]}
                tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={48}
                tickFormatter={(v: number) => fmt(v, 0)}
              />
              <Tooltip
                cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
                content={({ active, payload, label }) => {
                  const value = payload?.[0]?.value;
                  if (!active || typeof value !== "number") return null;
                  const ts = Number(label);
                  const during =
                    props.bands.find((b) => b.kind === "drive" && ts >= b.from && ts <= b.to) ??
                    props.bands.find((b) => ts >= b.from && ts <= b.to);
                  return (
                    <div className="min-w-[9rem] rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs shadow-lg">
                      <div className="text-[var(--text-primary)]">{tooltipTime(ts)}</div>
                      <div className="mt-2 flex items-center gap-2 border-t border-[var(--border)] pt-2">
                        <span className="text-[var(--text-secondary)]">{metric.label}</span>
                        <span className="ml-auto pl-4 font-medium tabular-nums text-[var(--text-primary)]">
                          {fmt(value, digits)}
                          <span className="ml-0.5 font-normal text-[var(--text-muted)]">{unit}</span>
                        </span>
                      </div>
                      {during && (
                        <div className="mt-1 flex items-center gap-2 text-[var(--text-secondary)]">
                          <span className="h-2 w-2 rounded-sm" style={{ background: BAND[during.kind].swatch }} />
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
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
        <li className="flex items-center gap-1.5">
          <span className="h-0.5 w-3 rounded-full bg-[var(--accent)]" />
          {metric.label} ({unit})
        </li>
        {(["drive", "charging", "plugged"] as const)
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

function DistancePanel(props: { drives: Parameters<typeof distanceByPeriod>[0]; from: Date; to: Date; hours: number }) {
  const u = useUnits();
  const loading = useLoading();
  const unit = props.hours <= 24 ? "hour" : "day";
  const buckets = useMemo(
    () => distanceByPeriod(props.drives, props.from.getTime(), props.to.getTime(), unit),
    [props.drives, props.from, props.to, unit],
  );
  const data = useMemo(() => buckets.map((b, i) => ({ i, km: u.distance(b.km) })), [buckets, u]);
  const label = (i: number) => {
    const ts = buckets[i]?.ts;
    if (ts == null) return "";
    return unit === "hour"
      ? new Date(ts).toLocaleTimeString([], { hour: "numeric" })
      : new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
  };
  const busiest = buckets.reduce<(typeof buckets)[number] | null>((best, b) => (b.km > (best?.km ?? 0) ? b : best), null);

  return (
    <Panel
      title={unit === "hour" ? "Distance by hour" : "Distance by day"}
      action={
        busiest && !loading ? (
          <span className="text-xs text-[var(--text-muted)]">
            Busiest {unit === "hour" ? new Date(busiest.ts).toLocaleTimeString([], { hour: "numeric" }) : new Date(busiest.ts).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}{" "}
            · {u.formatDistance(busiest.km)}
          </span>
        ) : undefined
      }
    >
      <ContentFrame height={160} loading={loading} empty={!busiest} emptyText="No drives in this period.">
        <TrendChart
          data={data}
          xKey="i"
          xType="category"
          height={160}
          leftDomain={[0, "auto"]}
          xFormatter={label}
          tooltipLabel={(i) => {
            const ts = buckets[i]?.ts;
            if (ts == null) return "";
            return unit === "hour"
              ? tooltipTime(ts)
              : new Date(ts).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
          }}
          series={[{ key: "km", label: "Distance", color: "var(--accent)", mark: "bar", unit: u.distanceUnit, digits: 0 }]}
        />
      </ContentFrame>
    </Panel>
  );
}

function Segmented(props: { items: string[]; value: number; onChange: (i: number) => void }) {
  return (
    <div className="flex shrink-0 rounded-md border border-[var(--border)] p-0.5">
      {props.items.map((label, i) => (
        <button
          key={label}
          onClick={() => props.onChange(i)}
          aria-pressed={i === props.value}
          className={`rounded px-2.5 py-1 text-xs ${
            i === props.value
              ? "bg-[var(--surface-2)] text-[var(--text-primary)]"
              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
