import type { BatteryHealthDto, VehicleInsightsDto, VehicleState } from "@server/api-types.js";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { api } from "../api/client.js";
import { useUnits, useVehicleState } from "../api/hooks.js";
import { FreshnessBadge } from "../components/FreshnessBadge.js";
import { ParkedEnergyPanel } from "../components/InsightsPanels.js";
import { ContentFrame, LoadingScope, Skeleton, useLoading } from "../components/loading.js";
import { Panel } from "../components/panels.js";
import { SoftwarePanel } from "../components/SoftwarePanel.js";
import { TrendChart } from "../components/TrendChart.js";
import {
  type CheckLevel,
  type TireKey,
  type TireTrend,
  TIRES,
  capacityTrend,
  capacityOfRated,
  healthChecks,
  healthSummary,
  tireLevel,
  tireTrend,
} from "../lib/health.js";
import { fmt, nv, sv } from "../lib/state.js";

const WINDOWS = [7, 30, 90] as const;

const LEVEL_COLOR: Record<CheckLevel, string> = {
  good: "var(--status-good)",
  info: "var(--accent)",
  attention: "var(--status-warning)",
  unknown: "var(--text-muted)",
};

/** "Oct 10, 12:53 PM": no seconds. */
const tooltipTime = (ms: number) =>
  new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const shortDate = (ms: number) => new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });

const TIRE_COLORS: Record<TireKey, string> = {
  fl: "var(--series-1)",
  fr: "var(--series-2)",
  rl: "var(--series-3)",
  rr: "var(--series-4)",
};

export function Health(props: { vehicleId: string }) {
  const { data: state, isPending: statePending } = useVehicleState(props.vehicleId);
  const { data: insights, isPending: insightsPending, isError: insightsError } = useQuery({
    queryKey: ["insights", props.vehicleId],
    queryFn: () => api.insights(props.vehicleId),
    refetchInterval: 60_000,
  });
  const { data: battery, isPending: batteryPending, isError: batteryError } = useQuery({
    queryKey: ["batteryHealth", props.vehicleId],
    queryFn: () => api.batteryHealth(props.vehicleId),
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-4">
      <LoadingScope loading={statePending}>
        <Overview state={state} />
      </LoadingScope>

      {(batteryError || insightsError) && (
        <p role="alert" className="text-sm text-[var(--status-critical)]">
          Could not refresh vehicle health readings. Existing values may be out of date.
        </p>
      )}

      <BatteryPanel
        battery={battery}
        insights={insights}
        batteryPending={batteryPending || statePending}
        insightsPending={insightsPending}
      />

      <TiresPanel vehicleId={props.vehicleId} state={state} statePending={statePending} />

      <SoftwarePanel vehicleId={props.vehicleId} />
    </div>
  );
}

/** The verdict up front, then each system the vehicle reports on. */
function Overview(props: { state: VehicleState | undefined }) {
  const loading = useLoading();
  const checks = healthChecks(props.state);
  const summary = healthSummary(checks);
  const color = LEVEL_COLOR[summary.level];

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-start gap-4 p-5">
        <span
          aria-hidden
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full"
          style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}
        >
          {loading ? null : <SummaryIcon level={summary.level} />}
        </span>
        <div className="min-w-[12rem] flex-1">
          <h2 className="text-lg font-semibold tracking-tight">{loading ? <Skeleton className="w-[10em]" /> : summary.title}</h2>
          <p className="mt-0.5 text-sm text-[var(--text-secondary)]">
            {loading ? <Skeleton className="w-[18em]" /> : summary.detail}
          </p>
        </div>
        <FreshnessBadge state={props.state} />
      </div>
      <ul className="grid grid-cols-2 gap-px border-t border-[var(--border)] bg-[var(--border)] sm:grid-cols-3 lg:grid-cols-6">
        {checks.map((c) => (
          <li key={c.key} className="bg-[var(--surface-1)] px-4 py-3">
            <div className="text-xs text-[var(--text-muted)]">{c.label}</div>
            <div className="mt-1 flex items-center gap-2 text-sm font-medium">
              {loading ? (
                <Skeleton className="w-[5em]" />
              ) : (
                <>
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: LEVEL_COLOR[c.level] }} />
                  <span className={`truncate ${c.level === "unknown" ? "text-[var(--text-muted)]" : ""}`}>{c.value}</span>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SummaryIcon(props: { level: CheckLevel }) {
  const path =
    props.level === "attention" ? "M8 4v5M8 11.5v.5" : props.level === "unknown" ? "M4.5 8h.01M8 8h.01M11.5 8h.01" : "M3.5 8.5l3 3 6-7";
  return (
    <svg viewBox="0 0 16 16" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d={path} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TiresPanel(props: { vehicleId: string; state: VehicleState | undefined; statePending: boolean }) {
  const [days, setDays] = useState<number>(30);
  const u = useUnits();
  const { data: tires, isPending } = useQuery({
    queryKey: ["tirePressures", props.vehicleId, days],
    queryFn: () => api.tirePressures(props.vehicleId, days),
    refetchInterval: 15 * 60_000,
    placeholderData: keepPreviousData,
  });

  const points = useMemo(
    () =>
      (tires ?? []).map((t) => ({ ts: Date.parse(t.ts), fl: t.frontLeft, fr: t.frontRight, rl: t.rearLeft, rr: t.rearRight })),
    [tires],
  );
  const trend = useMemo(() => tireTrend(points), [points]);
  const chartData = useMemo(
    () => points.map((p) => ({ ts: p.ts, fl: u.pressure(p.fl), fr: u.pressure(p.fr), rl: u.pressure(p.rl), rr: u.pressure(p.rr) })),
    [points, u],
  );
  const digits = u.pressureUnit === "psi" ? 1 : 2;
  const leaking = trend?.leaking ? TIRES.find((t) => t.key === trend.leaking) : null;

  return (
    <Panel title="Tires" action={<WindowPicker value={days} onChange={setDays} />}>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] md:items-center">
        <LoadingScope loading={props.statePending}>
          <TireDiagram state={props.state} trend={trend} days={days} />
        </LoadingScope>
        <div className="min-w-0">
          {leaking && (
            <p className="mb-3 text-sm text-[var(--status-warning)]">
              {leaking.label} is losing pressure faster than the others. It may have a slow leak.
            </p>
          )}
          <ContentFrame height={200} loading={isPending} empty={chartData.length === 0} emptyText="No tire pressure readings in this window yet.">
            <TrendChart
              data={chartData}
              xKey="ts"
              height={200}
              xFormatter={shortDate}
              tooltipLabel={tooltipTime}
              series={TIRES.map((t) => ({
                key: t.key,
                label: t.label,
                color: TIRE_COLORS[t.key],
                mark: "line" as const,
                unit: u.pressureUnit,
                digits,
              }))}
            />
          </ContentFrame>
        </div>
      </div>
    </Panel>
  );
}

/** Wheel positions in the diagram's 64×128 viewBox. */
const WHEEL_AT: Record<TireKey, [number, number]> = { fl: [4, 20], fr: [52, 20], rl: [4, 84], rr: [52, 84] };

/** The vehicle from above, with each tire's pressure beside it. */
function TireDiagram(props: { state: VehicleState | undefined; trend: TireTrend | null; days: number }) {
  const [fl, fr, rl, rr] = TIRES;
  const tire = (t: (typeof TIRES)[number]) => (
    <TireReading tire={t} state={props.state} trend={props.trend} days={props.days} />
  );
  const color = (t: (typeof TIRES)[number]) => {
    if (props.trend?.leaking === t.key) return LEVEL_COLOR.attention;
    const level = tireLevel(sv(props.state, t.status));
    return level === "good" ? "var(--text-secondary)" : LEVEL_COLOR[level];
  };

  return (
    <div className="mx-auto grid w-full max-w-[16rem] grid-cols-[1fr_auto_1fr] grid-rows-2 items-center gap-x-3 gap-y-6">
      {tire(fl!)}
      <svg viewBox="0 0 64 128" className="row-span-2 h-40 w-auto" aria-hidden>
        <rect x="10" y="4" width="44" height="120" rx="18" fill="var(--surface-2)" stroke="var(--border)" />
        <path d="M16 38 Q32 30 48 38 L46 52 Q32 47 18 52 Z" fill="var(--surface-0)" opacity="0.7" />
        <path d="M18 98 Q32 102 46 98 L47 108 Q32 114 17 108 Z" fill="var(--surface-0)" opacity="0.7" />
        {TIRES.map((t) => (
          <rect key={t.key} x={WHEEL_AT[t.key][0]} y={WHEEL_AT[t.key][1]} width="8" height="24" rx="3" fill={color(t)} />
        ))}
      </svg>
      {tire(fr!)}
      {tire(rl!)}
      {tire(rr!)}
    </div>
  );
}

function TireReading(props: {
  tire: (typeof TIRES)[number];
  state: VehicleState | undefined;
  trend: TireTrend | null;
  days: number;
}) {
  const u = useUnits();
  const loading = useLoading();
  const { tire } = props;
  const bar = nv(props.state, tire.pressure);
  const status = sv(props.state, tire.status);
  const level = tireLevel(status);
  const change = props.trend?.change[tire.key];
  const leaking = props.trend?.leaking === tire.key;
  const digits = u.pressureUnit === "psi" ? 0 : 2;
  const changeDigits = u.pressureUnit === "psi" ? 1 : 2;
  const changeText =
    change == null
      ? null
      : Math.abs(u.pressure(change)!) < (u.pressureUnit === "psi" ? 0.5 : 0.03)
        ? "Steady"
        : `${change > 0 ? "+" : "−"}${fmt(Math.abs(u.pressure(change)!), changeDigits)} ${u.pressureUnit}`;

  return (
    <div className="text-center">
      <div className="text-xs text-[var(--text-muted)]">{tire.label}</div>
      <div className="mt-0.5 tabular-nums">
        {loading ? (
          <Skeleton className="w-[3em]" />
        ) : bar != null ? (
          <>
            <span className="text-xl font-semibold" style={level === "attention" ? { color: LEVEL_COLOR.attention } : undefined}>
              {fmt(u.pressure(bar), digits)}
            </span>
            <span className="ml-1 text-xs text-[var(--text-muted)]">{u.pressureUnit}</span>
          </>
        ) : (
          <span className="text-sm" style={{ color: LEVEL_COLOR[level] }}>
            {status ? (level === "good" ? "OK" : status) : "—"}
          </span>
        )}
      </div>
      {!loading && level === "attention" && bar != null && (
        <div className="text-xs text-[var(--status-warning)]">{status}</div>
      )}
      {!loading && changeText && (
        <div
          title={`Change over the last ${props.days} days`}
          className={`text-xs tabular-nums ${leaking ? "text-[var(--status-warning)]" : "text-[var(--text-muted)]"}`}
        >
          {changeText}
        </div>
      )}
    </div>
  );
}

function BatteryPanel(props: {
  battery: BatteryHealthDto | undefined;
  insights: VehicleInsightsDto | undefined;
  batteryPending: boolean;
  insightsPending: boolean;
}) {
  const reported = props.battery?.reported;
  const latest = props.battery?.latest;
  const rated = props.battery?.ratedCapacity?.kwh ?? null;
  const trend = capacityTrend([...(reported ?? []), ...(latest ? [latest] : [])]);
  const ofRated = capacityOfRated(trend?.latestKwh, rated);
  const chartData = useMemo(
    () => (reported ?? []).map((r) => ({ ts: Date.parse(r.at), kwh: r.kwh, rated })),
    [reported, rated],
  );

  return (
    <Panel title="Battery">
      <div className="grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <LoadingScope loading={props.batteryPending}>
          <div className="min-w-0">
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
              <BigStat label="Usable capacity" value={trend ? fmt(trend.latestKwh, 1) : "—"} unit="kWh" />
              <div className="pb-1 text-sm text-[var(--text-secondary)]">
                <CapacityChange changeKwh={trend?.changeKwh ?? null} since={trend?.since ?? null} />
              </div>
            </div>
            <div className="mt-4">
              <ContentFrame
                height={180}
                loading={props.batteryPending}
                empty={chartData.length === 0}
                emptyText="No capacity readings recorded yet."
              >
                <TrendChart
                  data={chartData}
                  xKey="ts"
                  height={180}
                  xFormatter={shortDate}
                  tooltipLabel={tooltipTime}
                  series={[
                    { key: "kwh", label: "Usable capacity", color: "var(--series-2)", mark: "area", dots: chartData.length < 20, unit: "kWh", digits: 1 },
                    ...(rated != null && chartData.length > 1
                      ? [{ key: "rated", label: "Rated", color: "var(--text-muted)", mark: "line" as const, dashed: true, unit: "kWh", digits: 1 }]
                      : []),
                  ]}
                />
              </ContentFrame>
            </div>
          </div>
        </LoadingScope>

        <div className="min-w-0 space-y-5">
          <LoadingScope loading={props.batteryPending}>
            <div>
              <BigStat label="Capacity vs rated" value={ofRated != null ? fmt(ofRated, 1) : "—"} unit={ofRated != null ? "%" : ""} />
              <CapacityBar pct={ofRated} />
              <p className="mt-2 text-sm text-[var(--text-secondary)]">
                {ofRated != null && rated != null
                  ? `${fmt(trend!.latestKwh, 1)} of ${fmt(rated, 1)} kWh rated`
                  : "Shown once the vehicle reports its rated capacity."}
              </p>
            </div>
          </LoadingScope>
          <div className="border-t border-[var(--border)] pt-4">
            <h4 className="mb-3 text-xs uppercase tracking-wide text-[var(--text-muted)]">Used while parked</h4>
            <LoadingScope loading={props.insightsPending}>
              <ParkedEnergyPanel insights={props.insights} />
            </LoadingScope>
          </div>
        </div>
      </div>
    </Panel>
  );
}

/** Capacity against rated, as a filled track. */
function CapacityBar(props: { pct: number | null }) {
  const loading = useLoading();
  const filled = props.pct != null ? Math.min(100, props.pct) : 0;
  return (
    <div
      className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]"
      role="meter"
      aria-label="Capacity against rated"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={loading || props.pct == null ? undefined : Math.round(filled)}
    >
      {!loading && props.pct != null && <div className="h-full rounded-full bg-[var(--series-2)]" style={{ width: `${filled}%` }} />}
    </div>
  );
}

function BigStat(props: { label: string; value: ReactNode; unit: string }) {
  const loading = useLoading();
  return (
    <div>
      <div className="text-xs text-[var(--text-muted)]">{props.label}</div>
      <div className="mt-0.5 text-3xl font-semibold tabular-nums tracking-tight">
        {loading ? <Skeleton className="w-[4em]" /> : props.value}
        {props.unit && <span className="ml-1.5 text-base font-normal text-[var(--text-muted)]">{props.unit}</span>}
      </div>
    </div>
  );
}

function CapacityChange(props: { changeKwh: number | null; since: string | null }): ReactNode {
  const loading = useLoading();
  if (loading) return <Skeleton className="w-[10em]" />;
  if (props.changeKwh == null || !props.since) return <span className="text-[var(--text-muted)]">Tracking from today</span>;
  const since = new Date(props.since).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  if (Math.abs(props.changeKwh) < 0.5) return <>Steady since {since}</>;
  return (
    <>
      <span className="tabular-nums">
        {props.changeKwh > 0 ? "+" : "−"}
        {fmt(Math.abs(props.changeKwh), 1)} kWh
      </span>{" "}
      since {since}
    </>
  );
}

function WindowPicker(props: { value: number; onChange: (days: number) => void }) {
  return (
    <div className="flex shrink-0 rounded-md border border-[var(--border)] p-0.5">
      {WINDOWS.map((d) => (
        <button
          key={d}
          onClick={() => props.onChange(d)}
          className={`rounded px-2.5 py-1 text-xs ${
            d === props.value
              ? "bg-[var(--surface-2)] text-[var(--text-primary)]"
              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
        >
          {d}d
        </button>
      ))}
    </div>
  );
}
