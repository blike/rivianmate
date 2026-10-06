import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, type DcCurvesDto, type StatsDto } from "../api/client.js";
import { useUnits } from "../api/hooks.js";
import { BarList, type BarListItem } from "../components/BarList.js";
import { ContentFrame, LoadingScope } from "../components/loading.js";
import { Panel, StatCard } from "../components/panels.js";
import { SplitBar, SplitLegend } from "../components/SplitBar.js";
import { TrendChart } from "../components/TrendChart.js";
import { formatMoney } from "../lib/charging.js";
import { fmt, fmtSeconds } from "../lib/state.js";
import {
  MIN_EFFICIENCY_KM,
  type Granularity,
  chargeBuckets,
  driveAverageKmh,
  driveModeLabel,
  efficiencyDrives,
  granularityFor,
  groupEfficiency,
  localDay,
  percentile,
  rollingEfficiency,
  speedBandFor,
  speedBands,
} from "../lib/stats.js";
import type { UnitFormatter } from "../lib/units.js";

const PERIODS = [
  { label: "30d", days: 30, title: "the last 30 days" },
  { label: "90d", days: 90, title: "the last 90 days" },
  { label: "1y", days: 365, title: "the last year" },
  { label: "All", days: null, title: "all time" },
] as const;

type Period = (typeof PERIODS)[number];

const DAY_MS = 86_400_000;
const KM_PER_MI = 1.609344;
/** Drives in the rolling efficiency average. */
const ROLLING_DRIVES = 10;

const shortDate = (ms: number) => new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
const monthYear = (ms: number) => new Date(ms).toLocaleDateString([], { month: "short", year: "numeric" });

export function Stats(props: { vehicleId: string }) {
  const [period, setPeriod] = useState<Period>(PERIODS[3]);
  const u = useUnits();

  const { data: stats, isPending, isError, isPlaceholderData } = useQuery({
    queryKey: ["stats", props.vehicleId, period.days],
    queryFn: () => api.stats(props.vehicleId, period.days),
    refetchInterval: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
  const { data: dcCurves, isPending: dcPending } = useQuery({
    queryKey: ["dcCurves", props.vehicleId, period.days],
    queryFn: () => api.dcCurves(props.vehicleId, period.days),
    refetchInterval: 15 * 60_000,
    placeholderData: keepPreviousData,
  });

  return (
    <div className={`space-y-4 transition-opacity ${isPlaceholderData ? "opacity-60" : ""}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-[var(--text-secondary)]">
          {period.days == null ? "Everything RivianMate has recorded." : `Over ${period.title}.`}
        </p>
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>
      {isError && (
        <p role="alert" className="text-sm text-[var(--status-critical)]">
          Could not load stats. Shown values may be out of date.
        </p>
      )}
      <Totals stats={stats} loading={isPending} u={u} />
      <EfficiencyPanels stats={stats} loading={isPending} u={u} />
      <ChargingPanels stats={stats} loading={isPending} period={period} u={u} />
      <DcCurvesPanel curves={dcCurves} loading={dcPending} />
    </div>
  );
}

function PeriodPicker(props: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div role="group" aria-label="Period" className="flex shrink-0 rounded-md border border-[var(--border)] p-0.5">
      {PERIODS.map((p) => (
        <button
          key={p.label}
          aria-pressed={p === props.value}
          onClick={() => props.onChange(p)}
          className={`rounded px-2.5 py-1 text-xs ${
            p === props.value
              ? "bg-[var(--surface-2)] text-[var(--text-primary)]"
              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

function money(totals: { currency: string; amount: number }[]): string {
  return totals.length === 0 ? "—" : totals.map((t) => formatMoney(String(t.amount), t.currency)).join(" + ");
}

function Totals(props: { stats: StatsDto | undefined; loading: boolean; u: UnitFormatter }) {
  const { stats, u } = props;
  const d = stats?.driving;
  const c = stats?.charging;
  const measured = useMemo(() => efficiencyDrives(stats?.drives ?? []), [stats]);
  const measuredKm = measured.reduce((sum, x) => sum + x.distanceKm, 0);
  const measuredKwh = measured.reduce((sum, x) => sum + x.energyKwh, 0);

  // What driving costs: the average price paid per kWh × energy per distance.
  const price = c?.pricePerKwh;
  const kwhPerKm = d && d.energyDistanceKm > 0 ? d.energyKwh / d.energyDistanceKm : null;
  const costPerDistance =
    price && kwhPerKm != null ? price.amount * kwhPerKm * (u.distanceUnit === "mi" ? KM_PER_MI : 1) : null;

  return (
    <LoadingScope loading={props.loading}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Distance"
          value={u.formatDistance(d?.distanceKm)}
          sub={d ? `${fmt(d.drives)} drives · ${fmtSeconds(d.drivingSeconds)} driving` : "—"}
        />
        <StatCard
          label="Efficiency"
          value={u.formatEfficiency(measuredKm, measuredKwh)}
          sub={`Drives over ${u.formatDistance(MIN_EFFICIENCY_KM)}`}
        />
        <StatCard
          label="Energy used"
          value={d ? `${fmt(d.energyKwh, 0)} kWh` : "—"}
          sub="Driving, from battery level"
        />
        <StatCard
          label="Energy charged"
          value={c ? `${fmt(c.energyKwh, 0)} kWh` : "—"}
          sub={c ? `${fmt(c.sessions)} sessions · ${fmt(c.dcSessions)} DC fast` : "—"}
        />
        <StatCard
          label="Charging cost"
          value={c ? money(c.cost) : "—"}
          sub={
            costPerDistance != null && price
              ? `≈ ${formatMoney(String(costPerDistance), price.currency)}/${u.distanceUnit} · ${formatMoney(String(price.amount), price.currency)}/kWh`
              : "Set a home rate to estimate home costs"
          }
        />
        <StatCard
          label="Longest drive"
          value={u.formatDistance(d?.longest?.distanceKm)}
          sub={d?.longest ? new Date(d.longest.startedAt).toLocaleDateString() : "—"}
        />
        <StatCard label="Top speed" value={u.formatSpeed(d?.topSpeedKmh)} sub="From GPS" />
        <StatCard label="Odometer" value={u.formatDistance(stats?.odometerKm)} sub="Latest reading" />
      </div>
    </LoadingScope>
  );
}

function EfficiencyPanels(props: { stats: StatsDto | undefined; loading: boolean; u: UnitFormatter }) {
  const { u } = props;
  const measured = useMemo(() => efficiencyDrives(props.stats?.drives ?? []), [props.stats]);

  const trend = useMemo(
    () =>
      rollingEfficiency(measured, ROLLING_DRIVES).map(({ drive, rolling }) => ({
        ts: Date.parse(drive.startedAt),
        drive: u.efficiency(drive.distanceKm, drive.energyKwh),
        rolling: u.efficiency(rolling.distanceKm, rolling.energyKwh),
      })),
    [measured, u],
  );
  const perDrive = trend.flatMap((t) => (t.drive != null ? [t.drive] : []));
  const p10 = percentile(perDrive, 0.1);
  const p90 = percentile(perDrive, 0.9);
  const spanMs = trend.length > 1 ? trend.at(-1)!.ts - trend[0]!.ts : 0;

  const byMode = useMemo((): BarListItem[] => {
    const groups = groupEfficiency(measured, (d) => driveModeLabel(d.driveMode));
    return [...groups]
      .sort(([, a], [, b]) => b.drives - a.drives)
      .map(([label, g]) => efficiencyItem(label, g, u));
  }, [measured, u]);

  const bySpeed = useMemo((): BarListItem[] => {
    const bands = speedBands(u.distanceUnit === "mi");
    const groups = groupEfficiency(measured, (d) => {
      const kmh = driveAverageKmh(d);
      return kmh == null ? null : speedBandFor(bands, kmh).label;
    });
    return bands.flatMap((b) => {
      const g = groups.get(b.label);
      return g ? [efficiencyItem(b.label, g, u)] : [];
    });
  }, [measured, u]);

  const better = u.efficiencyHigherIsBetter ? "higher" : "lower";
  const emptyText = `No drives over ${u.formatDistance(MIN_EFFICIENCY_KM)} with a known energy use in this period.`;

  return (
    <>
      <Panel title="Efficiency over time">
        <p className="mb-3 text-xs text-[var(--text-muted)]">
          Each dot is a drive, in {u.efficiencyUnit} ({better} is better). The line averages the last {ROLLING_DRIVES}{" "}
          drives, weighted by distance.
          {p10 != null && p90 != null && perDrive.length >= 5 && (
            <>
              {" "}
              The middle 80% of drives fall between {fmt(Math.min(p10, p90), u.efficiencyDigits)} and{" "}
              {fmt(Math.max(p10, p90), u.efficiencyDigits)} {u.efficiencyUnit}.
            </>
          )}
        </p>
        <ContentFrame height={240} loading={props.loading} empty={trend.length === 0} emptyText={emptyText}>
          <TrendChart
            data={trend}
            xKey="ts"
            height={240}
            xFormatter={spanMs > 365 * DAY_MS ? monthYear : shortDate}
            tooltipLabel={(ms) => new Date(ms).toLocaleString()}
            series={[
              { key: "drive", label: "Drive", color: "var(--series-1)", mark: "dots", unit: u.efficiencyUnit, digits: u.efficiencyDigits },
              { key: "rolling", label: `${ROLLING_DRIVES}-drive average`, color: "var(--accent)", mark: "line", unit: u.efficiencyUnit, digits: u.efficiencyDigits },
            ]}
          />
        </ContentFrame>
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          Energy is the battery-level drop × pack capacity, so climate and other use during the drive count too.
        </p>
      </Panel>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Panel title="Efficiency by drive mode">
          <ContentFrame height={160} loading={props.loading} empty={byMode.length === 0} emptyText={emptyText}>
            <BarList items={byMode} color="var(--series-2)" />
          </ContentFrame>
        </Panel>
        <Panel title="Efficiency by average speed">
          <ContentFrame height={160} loading={props.loading} empty={bySpeed.length === 0} emptyText={emptyText}>
            <BarList items={bySpeed} color="var(--series-3)" />
          </ContentFrame>
          {bySpeed.length > 0 && (
            <p className="mt-3 text-xs text-[var(--text-muted)]">Average speed over the whole drive, stops included.</p>
          )}
        </Panel>
      </div>
    </>
  );
}

function efficiencyItem(
  label: string,
  g: { drives: number; distanceKm: number; energyKwh: number },
  u: UnitFormatter,
): BarListItem {
  return {
    key: label,
    label,
    value: u.efficiency(g.distanceKm, g.energyKwh) ?? 0,
    valueLabel: u.formatEfficiency(g.distanceKm, g.energyKwh),
    sub: `${fmt(g.drives)} ${g.drives === 1 ? "drive" : "drives"} · ${u.formatDistance(g.distanceKm)}`,
  };
}

const BUCKET_LABEL: Record<Granularity, (ms: number) => string> = {
  day: (ms) => new Date(ms).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }),
  week: (ms) => `Week of ${shortDate(ms)}`,
  month: (ms) => new Date(ms).toLocaleDateString([], { month: "long", year: "numeric" }),
};

function ChargingPanels(props: { stats: StatsDto | undefined; loading: boolean; period: Period; u: UnitFormatter }) {
  const c = props.stats?.charging;
  const since = props.stats?.since;

  const { buckets, granularity } = useMemo(() => {
    const days = c?.days ?? [];
    const now = new Date();
    const from = since ? new Date(since) : days[0] ? localDay(days[0].day) : null;
    const span = from ? (now.getTime() - from.getTime()) / DAY_MS : 0;
    const granularity = granularityFor(span);
    return { buckets: chargeBuckets(days, granularity, now, from ?? undefined), granularity };
  }, [c, since]);
  const hasUnknown = buckets.some((b) => b.unknownKwh > 0);

  const networks = useMemo(
    (): BarListItem[] =>
      (c?.networks ?? []).map((n) => ({
        key: n.name,
        label: n.name,
        value: n.energyKwh,
        valueLabel: `${fmt(n.energyKwh, 0)} kWh`,
        sub: [`${fmt(n.sessions)} ${n.sessions === 1 ? "session" : "sessions"}`, n.cost.length ? money(n.cost) : null]
          .filter(Boolean)
          .join(" · "),
      })),
    [c],
  );

  return (
    <>
      <Panel title="Energy charged">
        <ContentFrame
          height={220}
          loading={props.loading}
          empty={!c || c.energyKwh === 0}
          emptyText="No charging recorded in this period."
        >
          <TrendChart
            data={buckets}
            xKey="start"
            xType="category"
            height={220}
            xFormatter={granularity === "month" ? monthYear : shortDate}
            tooltipLabel={BUCKET_LABEL[granularity]}
            series={[
              { key: "acKwh", label: "AC", color: "var(--series-2)", mark: "bar", stack: "energy", unit: "kWh", digits: 0 },
              { key: "dcKwh", label: "DC fast", color: "var(--series-1)", mark: "bar", stack: "energy", unit: "kWh", digits: 0 },
              ...(hasUnknown
                ? [{ key: "unknownKwh", label: "Unknown", color: "var(--text-muted)", mark: "bar" as const, stack: "energy", unit: "kWh", digits: 0 }]
                : []),
            ]}
          />
        </ContentFrame>
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          Per {granularity}, by when each session started. Sessions reaching 20 kW or more count as DC fast charging.
        </p>
      </Panel>

      <Panel title="Where you charge">
        <LoadingScope loading={props.loading}>
          {c && c.energyKwh > 0 ? (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="space-y-3">
                <SplitBar
                  segments={[
                    { key: "home", label: "Home", kwh: c.homeKwh, color: "var(--series-2)" },
                    { key: "away", label: "Away", kwh: c.awayKwh, color: "var(--series-1)" },
                  ]}
                />
                <SplitLegend
                  items={[
                    { key: "home", label: "Home", color: "var(--series-2)", kwh: c.homeKwh },
                    { key: "away", label: "Away", color: "var(--series-1)", kwh: c.awayKwh },
                  ]}
                />
                <p className="text-xs text-[var(--text-muted)]">
                  {fmt((c.homeKwh / c.energyKwh) * 100, 0)}% of energy charged at home. {fmt(c.acSessions)} AC and{" "}
                  {fmt(c.dcSessions)} DC fast sessions.
                </p>
              </div>
              <BarList items={networks} color="var(--series-4)" />
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-[var(--text-muted)]">
              {props.loading ? "Loading…" : "No charging recorded in this period."}
            </p>
          )}
        </LoadingScope>
      </Panel>
    </>
  );
}

function DcCurvesPanel(props: { curves: DcCurvesDto | undefined; loading: boolean }) {
  const { rows, series, sessions } = useMemo(() => {
    const sessions = props.curves?.sessions ?? [];
    // Older and newer halves, to see whether charging speed is changing.
    const split = sessions.length >= 4 ? Math.floor(sessions.length / 2) : 0;
    const newerIds = new Set(sessions.slice(split).map((s) => s.id));
    const splitAt = split > 0 ? sessions[split]!.startedAt : null;
    const rows = (props.curves?.points ?? []).map((p) => ({
      soc: p.soc,
      older: newerIds.has(p.sessionId) ? null : p.powerKw,
      newer: newerIds.has(p.sessionId) ? p.powerKw : null,
    }));
    const since = splitAt ? new Date(splitAt).toLocaleDateString() : null;
    const series = since
      ? [
          { key: "older", label: `Before ${since}`, color: "var(--text-muted)", mark: "dots" as const, unit: "kW", digits: 0 },
          { key: "newer", label: `Since ${since}`, color: "var(--series-1)", mark: "dots" as const, unit: "kW", digits: 0 },
        ]
      : [{ key: "newer", label: "DC session", color: "var(--series-1)", mark: "dots" as const, unit: "kW", digits: 0 }];
    return { rows, series, sessions };
  }, [props.curves]);

  return (
    <Panel title="DC fast charging curves">
      <p className="mb-3 text-xs text-[var(--text-muted)]">
        Charging power by battery level across {sessions.length > 0 ? fmt(sessions.length) : "your"} DC fast{" "}
        {sessions.length === 1 ? "session" : "sessions"}. Lower power at the same battery level over time can point to
        an ageing pack, though a cold pack or a busy or slower station lowers it too.
      </p>
      <ContentFrame
        height={240}
        loading={props.loading}
        empty={rows.length === 0}
        emptyText="No DC fast charging with a recorded power curve in this period."
      >
        <TrendChart
          data={rows}
          xKey="soc"
          height={240}
          xFormatter={(soc) => `${fmt(soc, 0)}%`}
          tooltipLabel={(soc) => `${fmt(soc, 0)}% battery`}
          leftDomain={[0, "auto"]}
          leftUnit="kW"
          series={series}
        />
      </ContentFrame>
    </Panel>
  );
}
