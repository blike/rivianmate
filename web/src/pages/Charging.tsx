import { chargingCurveWindow } from "../lib/chargingCurve.js";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { api, type ChargingSessionDto, type WallboxDto } from "../api/client.js";
import { useLiveCharging, useUnits, useVehicleState } from "../api/hooks.js";
import { ContentFrame, LoadingScope, Skeleton, SkeletonRows, useLoading } from "../components/loading.js";
import { Panel, Row } from "../components/panels.js";
import { SchedulesPanel } from "../components/SchedulesPanel.js";
import { SplitBar, SplitLegend } from "../components/SplitBar.js";
import { TrendChart } from "../components/TrendChart.js";
import {
  chargerLabel,
  chargingSecondsNow,
  formatMoney,
  sessionCost,
  sessionTotals,
  socRange,
} from "../lib/charging.js";
import { groupByDay, minuteTicks } from "../lib/drives.js";
import { RecordPicker } from "../components/RecordPicker.js";
import { smoothByTime, smoothingWindowMinutes } from "../lib/smoothing.js";
import { fmt, fmtDuration, fmtSeconds, nv, sv, titleCase } from "../lib/state.js";

const clock = (iso: string | number) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const longDay = (iso: string) =>
  new Date(iso).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" });

export function Charging(props: { vehicleId: string }) {
  const queryClient = useQueryClient();
  const { data: live } = useLiveCharging(props.vehicleId);
  const { data: state } = useVehicleState(props.vehicleId);

  const { data: sessions, isPending: sessionsPending } = useQuery({
    queryKey: ["chargingSessions", props.vehicleId],
    queryFn: () => api.chargingSessions(props.vehicleId),
    refetchInterval: 60_000,
  });

  const { data: wallboxes } = useQuery({
    queryKey: ["wallboxes"],
    queryFn: api.wallboxes,
    refetchInterval: 60_000,
  });

  const costMutation = useMutation({
    mutationFn: ({ id, cost }: { id: number; cost: string | null }) => api.updateSessionCost(id, cost),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["chargingSessions", props.vehicleId] }),
  });
  const saveCost = (id: number) => (cost: string | null) => costMutation.mutate({ id, cost });

  const isLive = live?.vehicleChargerState?.value === "charging_active";
  // The live session arrives over SSE just after the page loads; if the
  // vehicle state already says it's charging, hold its place meanwhile.
  const liveExpected = live === undefined && sv(state, "chargerStatus") === "chrgr_sts_connected_charging";

  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const session = sessions?.find((s) => s.id === selectedSessionId) ?? sessions?.[0];

  const {
    data: curve,
    isPending: curvePending,
    isPlaceholderData: showingPreviousCurve,
  } = useQuery({
    queryKey: ["chargingCurve", session?.id],
    queryFn: () => api.chargingCurve(session!.id),
    enabled: session != null,
    refetchInterval: session && !session.endedAt ? 30_000 : false,
    // Keep the previous curve on screen (dimmed) while the next one loads.
    placeholderData: keepPreviousData,
  });

  if (!sessionsPending && !sessions?.length) {
    return (
      <div className="space-y-4">
        {(isLive || liveExpected) && <LiveCard live={live} loading={!isLive} state={state} />}
        <Panel title="Charging sessions">
          <p className="py-6 text-center text-sm text-[var(--text-muted)]">No charging sessions recorded yet.</p>
        </Panel>
        <ScheduleRow vehicleId={props.vehicleId} wallboxes={wallboxes} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {(isLive || liveExpected) && <LiveCard live={live} loading={!isLive} state={state} />}

      {sessions && sessions.length > 1 && (
        <SessionPicker sessions={sessions} selectedId={session?.id ?? null} onSelect={setSelectedSessionId} />
      )}
      <div className={`transition-opacity ${showingPreviousCurve ? "opacity-50" : ""}`}>
        <LoadingScope loading={sessionsPending}>
          <SessionCard session={session} onSaveCost={session ? saveCost(session.id) : undefined} />
        </LoadingScope>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="Charging curve" className={`transition-opacity ${showingPreviousCurve ? "opacity-50" : ""}`}>
          <CurveChart curve={curve} loading={sessionsPending || (session != null && curvePending)} />
          {session?.packKwh != null && session.thermalKwh != null && (
            <EnergySplit packKwh={session.packKwh} thermalKwh={session.thermalKwh} />
          )}
        </Panel>

        <Panel title="All sessions" className="hidden flex-col lg:flex">
          <div className="relative min-h-0 flex-1">
            <div className="-mx-4 max-h-[28rem] overflow-auto lg:absolute lg:inset-0 lg:max-h-none">
              {sessionsPending ? (
                <div className="px-4">
                  <SkeletonRows rows={8} />
                </div>
              ) : (
                <SessionList sessions={sessions!} selectedId={session?.id ?? null} onSelect={setSelectedSessionId} />
              )}
            </div>
          </div>
        </Panel>
      </div>

      <ScheduleRow vehicleId={props.vehicleId} wallboxes={wallboxes} />
    </div>
  );
}

/** Schedules, then any wallboxes beside them. */
function ScheduleRow(props: { vehicleId: string; wallboxes: WallboxDto[] | undefined }) {
  const wallboxes = props.wallboxes ?? [];
  return (
    <div className={`grid grid-cols-1 items-start gap-4 ${wallboxes.length ? "lg:grid-cols-2" : ""}`}>
      <SchedulesPanel vehicleId={props.vehicleId} />
      {wallboxes.length > 0 && (
        <div className="grid grid-cols-1 gap-4">
          {wallboxes.map((wb) => (
            <WallboxPanel key={wb.wallboxId} wallbox={wb} />
          ))}
        </div>
      )}
    </div>
  );
}

type Live = ReturnType<typeof useLiveCharging>["data"];

/** A charge in progress: how full, how fast, and when it's done. */
function LiveCard(props: { live: Live; loading: boolean; state: ReturnType<typeof useVehicleState>["data"] }) {
  const u = useUnits();
  const live = props.live;
  const soc = num(live?.soc?.value) ?? nv(props.state, "batteryLevel");
  const limit = num(live?.socLimit?.value) ?? nv(props.state, "batteryLimit");
  const secondsLeft = num(live?.timeRemaining?.value);
  // Counted from when the vehicle reported the time left.
  const reportedAt = Date.parse(live?.timeRemaining?.updatedAt ?? "");
  const finish =
    secondsLeft != null && secondsLeft > 0 && Number.isFinite(reportedAt) ? clock(reportedAt + secondsLeft * 1000) : null;
  const rate = num(live?.kilometersChargedPerHour?.value);

  const tiles: { label: string; value: ReactNode; sub?: ReactNode }[] = [
    { label: "Power", value: `${fmt(num(live?.power?.value), 1)} kW`, sub: rate != null ? u.formatChargeRate(rate) : undefined },
    {
      label: "Energy added",
      value: `${fmt(num(live?.totalChargedEnergy?.value), 1)} kWh`,
      sub: live?.rangeAddedThisSession ? `${u.formatDistance(num(live.rangeAddedThisSession.value))} of range` : undefined,
    },
    {
      label: "Time remaining",
      value: secondsLeft != null ? fmtSeconds(secondsLeft) : "—",
      sub: finish ? `Done around ${finish}` : undefined,
    },
  ];

  return (
    <LoadingScope loading={props.loading}>
      <section className="card overflow-hidden border-[color-mix(in_srgb,var(--status-good)_45%,var(--border))]">
        <div className="p-5">
          <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-[var(--status-good)]">
            <span className="chip-dot--pulse h-1.5 w-1.5 rounded-full bg-[var(--status-good)] text-[var(--status-good)]" />
            Charging now
          </div>
          <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <div className="text-3xl font-semibold tabular-nums tracking-tight">
              {props.loading ? <Skeleton className="w-[3em]" /> : `${fmt(soc, 0)}%`}
              {limit != null && !props.loading && (
                <span className="ml-2 text-base font-normal text-[var(--text-muted)]">of {fmt(limit, 0)}% limit</span>
              )}
            </div>
          </div>
          <SocTrack soc={soc} limit={limit} />
        </div>
        <TileRow tiles={tiles} columns="sm:grid-cols-3" />
      </section>
    </LoadingScope>
  );
}

/** Battery level toward the charge limit, with the limit marked. */
function SocTrack(props: { soc: number | null; limit: number | null }) {
  const loading = useLoading();
  const soc = Math.max(0, Math.min(100, props.soc ?? 0));
  return (
    <div className="relative mt-3 h-2 rounded-full bg-[var(--surface-2)]">
      {!loading && (
        <div className="h-full rounded-full bg-[var(--status-good)] transition-[width] duration-700" style={{ width: `${soc}%` }} />
      )}
      {props.limit != null && (
        <span
          aria-hidden
          className="absolute -top-1 bottom-[-4px] w-0.5 rounded-full bg-[var(--text-secondary)]"
          style={{ left: `calc(${Math.min(100, props.limit)}% - 1px)` }}
        />
      )}
    </div>
  );
}

/** The chosen session: where and when up front, then its figures. */
function SessionCard(props: { session: ChargingSessionDto | undefined; onSaveCost?: (cost: string | null) => void }) {
  const u = useUnits();
  const loading = useLoading();
  const s = props.session;
  const chargingSeconds = s ? chargingSecondsNow(s) : null;
  const cost = s ? sessionCost(s) : null;
  const energy = s?.energyKwh ?? null;

  const tiles: { label: string; value: ReactNode; sub?: ReactNode }[] = [
    {
      label: "Energy added",
      value: energy != null ? `${fmt(energy, 1)} kWh` : "—",
      sub: s?.rangeAddedKm != null ? `${u.formatDistance(s.rangeAddedKm)} of range` : undefined,
    },
    {
      label: "Battery",
      value: s ? socRange(s.startSoc, s.endSoc) : "—",
      sub: s?.startSoc != null && s.endSoc != null ? `+${fmt(s.endSoc - s.startSoc, 0)}%` : undefined,
    },
    {
      label: "Time charging",
      value: chargingSeconds != null ? fmtSeconds(chargingSeconds) : "—",
      sub: s ? `Plugged in ${fmtDuration(s.startedAt, s.endedAt)}` : undefined,
    },
    {
      label: "Power",
      value: s?.maxPowerKw != null ? `${fmt(s.maxPowerKw, 1)} kW peak` : "—",
      sub: s?.avgPowerKw != null ? `${fmt(s.avgPowerKw, 1)} kW average` : undefined,
    },
    {
      label: "Cost",
      value: s && props.onSaveCost ? <CostEditor key={s.id} session={s} onSave={props.onSaveCost} /> : "—",
      sub:
        cost && energy
          ? `${formatMoney(String(cost.amount / energy), s?.currency ?? null)} per kWh${cost.estimated ? " (home rate)" : ""}`
          : "Click to add",
    },
  ];

  return (
    <section className="card overflow-hidden">
      <div className="p-5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
          {loading || !s ? (
            <Skeleton className="w-[14em]" />
          ) : (
            <>
              {!s.endedAt && (
                <span
                  className={`font-medium uppercase tracking-wide ${s.chargingSince ? "text-[var(--status-good)]" : "text-[var(--text-secondary)]"}`}
                >
                  {s.chargingSince ? "Charging" : "Plugged in"}
                </span>
              )}
              <TimeRange session={s} />
              {s.source === "rivian" && <SourceBadge />}
            </>
          )}
        </div>
        <h2 className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-2 text-xl font-semibold tracking-tight">
          {loading || !s ? (
            <Skeleton className="w-[12em]" />
          ) : (
            <>
              <span className="min-w-0 truncate">
                {s.isHome && <HomeIcon />}
                {chargerLabel(s)}
              </span>
              {s.city && !s.isHome && <span className="text-base font-normal text-[var(--text-secondary)]">{s.city}</span>}
            </>
          )}
        </h2>
      </div>
      <TileRow tiles={tiles} columns="sm:grid-cols-3 lg:grid-cols-5" />
    </section>
  );
}

/** When a session started charging; the plug-in time when that wasn't recorded. */
const chargeStart = (s: ChargingSessionDto) => s.chargingStartedAt ?? s.startedAt;

/**
 * When it charged, e.g. "Thu, Oct 8 · 7:03 – 10:12 AM"; a charge still
 * running ends "now". Falls back to the plug-in times when the vehicle's
 * charger status wasn't recorded (e.g. sessions imported from Rivian).
 */
function TimeRange(props: { session: ChargingSessionDto }) {
  const s = props.session;
  const from = chargeStart(s);
  const charging = !s.endedAt && s.chargingSince != null;
  const to = charging ? null : (s.chargingEndedAt ?? s.endedAt);
  return (
    <span title={s.chargingStartedAt ? `Plugged in ${clock(s.startedAt)}${s.endedAt ? ` – ${clock(s.endedAt)}` : ""}` : undefined}>
      {longDay(from)} · {clock(from)}
      {to ? ` – ${clock(to)}` : charging ? " – now" : ""}
    </span>
  );
}

function TileRow(props: { tiles: { label: string; value: ReactNode; sub?: ReactNode }[]; columns: string }) {
  const loading = useLoading();
  return (
    <ul className={`grid grid-cols-2 gap-px border-t border-[var(--border)] bg-[var(--border)] ${props.columns}`}>
      {props.tiles.map((t) => (
        <li key={t.label} className="bg-[var(--surface-1)] px-4 py-3 last:max-sm:col-span-2">
          <div className="text-xs text-[var(--text-muted)]">{t.label}</div>
          <div className="mt-1 text-base font-semibold tabular-nums">{loading ? <Skeleton className="w-[5em]" /> : t.value}</div>
          <div className="truncate text-xs text-[var(--text-secondary)]">
            {loading ? <Skeleton className="w-[7em]" /> : (t.sub ?? " ")}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Power and battery level through the session, with the vehicle's forecast while it charges. */
function CurveChart(props: { curve: Parameters<typeof chargingCurveWindow>[0] | undefined; loading: boolean }) {
  // Start elapsed time at the first recorded power reading, not plug-in.
  const curveWindow = useMemo(() => chargingCurveWindow(props.curve ?? []), [props.curve]);
  const data = useMemo(() => {
    const { points, originMs } = curveWindow;
    const minutes = points.map((p) => (Date.parse(p.ts) - (originMs ?? 0)) / 60_000);
    // Recorded points come first, then the forecast.
    const recordedCount = points.filter((p) => !p.projected).length;
    const window = smoothingWindowMinutes((minutes.at(-1) ?? 0) - (minutes[0] ?? 0));
    const recordedMinutes = minutes.slice(0, recordedCount);
    const recorded = points.slice(0, recordedCount);
    const soc = smoothByTime(recordedMinutes, recorded.map((p) => p.soc), window);
    const forecast = smoothByTime(minutes.slice(recordedCount), points.slice(recordedCount).map((p) => p.soc), window);
    const hasForecast = forecast.length > 0;
    return points.map((_, i) => {
      const isRecorded = i < recordedCount;
      return {
        minutes: minutes[i]!,
        power: isRecorded ? recorded[i]!.powerKw : null,
        soc: isRecorded ? soc[i]! : null,
        forecast: isRecorded ? (hasForecast && i === recordedCount - 1 ? soc[i]! : null) : forecast[i - recordedCount]!,
      };
    });
  }, [curveWindow]);

  const hasForecast = curveWindow.points.some((p) => p.projected);
  // Without power, the curve is battery level from recorded vehicle state.
  const hasPower = data.some((p) => p.power != null);
  const total = data.at(-1)?.minutes ?? 0;
  const ticks = minuteTicks(data[0]?.minutes ?? 0, total);
  const formatTime = (m: number) => (total >= 120 ? fmtSeconds(m * 60) : `${fmt(m, 0)} min`);
  const tooltipTime = (m: number) => {
    const elapsed = fmtSeconds(m * 60);
    if (curveWindow.originMs == null) return elapsed;
    return (
      <>
        <div className="font-medium">{clock(curveWindow.originMs + m * 60_000)}</div>
        <div className="text-[var(--text-muted)]">{elapsed} in</div>
      </>
    );
  };
  const forecastSeries = hasForecast
    ? [{ key: "forecast", label: "Forecast", color: "var(--accent)", mark: "line" as const, dashed: true, unit: "%", digits: 0 }]
    : [];

  return (
    <>
      <ContentFrame
        height={260}
        loading={props.loading}
        empty={data.length <= 1}
        emptyText="No charging data for this session: Rivian didn't provide a power curve, and RivianMate wasn't recording while it charged."
      >
        {hasPower ? (
          <TrendChart
            data={data}
            xKey="minutes"
            height={260}
            xTicks={ticks}
            xFormatter={formatTime}
            tooltipLabel={tooltipTime}
            leftDomain={[0, "auto"]}
            leftUnit="kW"
            rightUnit="%"
            rightDomain={[0, 100]}
            series={[
              { key: "power", label: "Power", interpolation: "linear", connectNulls: false, color: "var(--series-1)", unit: "kW", digits: 1 },
              { key: "soc", label: "Battery", color: "var(--accent)", mark: "line", right: true, unit: "%", digits: 0 },
              ...forecastSeries.map((f) => ({ ...f, right: true })),
            ]}
          />
        ) : (
          <TrendChart
            data={data}
            xKey="minutes"
            height={260}
            xTicks={ticks}
            xFormatter={formatTime}
            tooltipLabel={tooltipTime}
            leftDomain={[0, 100]}
            leftUnit="%"
            series={[{ key: "soc", label: "Battery", color: "var(--accent)", mark: "line", unit: "%", digits: 0, dots: true }, ...forecastSeries]}
          />
        )}
      </ContentFrame>
      {!props.loading && !hasPower && data.length > 1 && (
        <p className="mt-2 text-xs text-[var(--text-muted)]">Rivian didn’t provide power for this session, so this is battery level only.</p>
      )}
    </>
  );
}

/** On narrow screens, a picker up top stands in for the list. */
function SessionPicker(props: { sessions: ChargingSessionDto[]; selectedId: number | null; onSelect: (id: number) => void }) {
  const groups = useMemo(
    () =>
      groupByDay(props.sessions, new Date(), chargeStart).map((day) => ({
        key: day.key,
        label: day.label,
        items: day.items.map((s) => ({
          id: s.id,
          label: [clock(chargeStart(s)), chargerLabel(s), s.energyKwh != null && `${fmt(s.energyKwh, 1)} kWh`].filter(Boolean).join(" · "),
        })),
      })),
    [props.sessions],
  );
  return (
    <RecordPicker
      label="Session"
      groups={groups}
      selectedId={props.selectedId}
      onSelect={props.onSelect}
      className="sticky top-2 z-20 lg:hidden"
    />
  );
}

/** Sessions by day, newest first, each day with its energy and cost. */
function SessionList(props: { sessions: ChargingSessionDto[]; selectedId: number | null; onSelect: (id: number) => void }) {
  // Listed by when each started charging, which can be hours after plug-in.
  const days = useMemo(() => groupByDay(props.sessions, new Date(), chargeStart), [props.sessions]);
  return (
    <div>
      {days.map((day) => {
        const totals = sessionTotals(day.items);
        const currency = day.items.find((s) => s.currency)?.currency ?? null;
        return (
          <section key={day.key}>
            <h4 className="sticky top-0 z-10 flex items-baseline justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-1)] px-4 py-2 text-xs">
              <span className="font-medium uppercase tracking-wide text-[var(--text-muted)]">{day.label}</span>
              <span className="tabular-nums text-[var(--text-muted)]">
                {fmt(totals.energyKwh, 1)} kWh
                {totals.cost != null && ` · ${totals.estimated ? "≈ " : ""}${formatMoney(String(totals.cost), currency)}`}
              </span>
            </h4>
            <ul>
              {day.items.map((s) => (
                <SessionItem key={s.id} session={s} selected={props.selectedId === s.id} onSelect={() => props.onSelect(s.id)} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function SessionItem(props: { session: ChargingSessionDto; selected: boolean; onSelect: () => void }) {
  const s = props.session;
  const cost = sessionCost(s);
  const charging = chargingSecondsNow(s);
  const facts = [
    s.startSoc != null && s.endSoc != null && socRange(s.startSoc, s.endSoc),
    charging != null ? fmtSeconds(charging) : fmtDuration(s.startedAt, s.endedAt),
    cost && `${cost.estimated ? "≈ " : ""}${formatMoney(String(cost.amount), s.currency)}`,
  ].filter(Boolean);

  return (
    <li>
      <button
        onClick={props.onSelect}
        aria-current={props.selected ? "true" : undefined}
        className={`relative grid w-full grid-cols-[4.5rem_minmax(0,1fr)_auto] items-baseline gap-x-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--surface-2)] ${
          props.selected ? "bg-[var(--surface-2)]" : ""
        }`}
      >
        {props.selected && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-[var(--accent)]" />}
        <span
          className="text-xs tabular-nums text-[var(--text-muted)]"
          title={s.chargingStartedAt ? `Plugged in ${clock(s.startedAt)}` : undefined}
        >
          {clock(chargeStart(s))}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm">
            <span className={s.isHome ? "font-medium" : ""}>{chargerLabel(s)}</span>
            {s.city && !s.isHome && <span className="text-[var(--text-muted)]"> · {s.city}</span>}
          </span>
          <span className="mt-0.5 block truncate text-xs tabular-nums text-[var(--text-muted)]">
            {!s.endedAt && (
              <span className={`mr-1.5 ${s.chargingSince ? "text-[var(--status-good)]" : ""}`}>
                {s.chargingSince ? "Charging" : "Plugged in"} ·
              </span>
            )}
            {facts.join(" · ")}
          </span>
        </span>
        <span className="text-sm font-medium tabular-nums">{s.energyKwh != null ? `${fmt(s.energyKwh, 1)} kWh` : "—"}</span>
      </button>
    </li>
  );
}

function WallboxPanel(props: { wallbox: WallboxDto }) {
  const wb = props.wallbox;
  return (
    <Panel title={wb.name ?? wb.wallboxId}>
      <dl className="space-y-1 text-sm">
        <Row label="Status" value={titleCase(wb.latest?.chargingStatus ?? null)} />
        <Row
          label="Power"
          value={wb.latest?.power != null ? `${fmt(wb.latest.power, 1)} kW / ${fmt(wb.maxPower, 1)} kW` : "—"}
        />
        <Row
          label="Output"
          value={
            wb.latest?.currentAmps != null ? `${fmt(wb.latest.currentAmps, 0)} A @ ${fmt(wb.latest.currentVoltage, 0)} V` : "—"
          }
        />
        <Row label="Model" value={wb.model ?? "—"} />
        <Row label="Firmware" value={wb.softwareVersion ?? "—"} />
      </dl>
    </Panel>
  );
}

/** The session's cost, edited in place: the recorded one, or the home-rate estimate in muted text. */
function CostEditor(props: { session: ChargingSessionDto; onSave: (cost: string | null) => void }) {
  const s = props.session;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(s.cost ?? "");

  if (!editing) {
    return (
      <button
        className="tabular-nums underline decoration-[var(--text-muted)] decoration-dotted underline-offset-4 hover:decoration-[var(--text-primary)]"
        onClick={() => {
          setValue(s.cost ?? "");
          setEditing(true);
        }}
        title="Edit cost"
      >
        {s.cost != null ? (
          formatMoney(s.cost, s.currency)
        ) : s.estimatedCost != null ? (
          <span className="text-[var(--text-secondary)]" title="Estimated from your home electricity rate">
            ≈ {formatMoney(s.estimatedCost, s.currency)}
          </span>
        ) : (
          <span className="text-[var(--text-muted)]">Add</span>
        )}
      </button>
    );
  }
  return (
    <input
      autoFocus
      inputMode="decimal"
      aria-label="Session cost"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        setEditing(false);
        const trimmed = value.trim();
        if (trimmed === "") props.onSave(null);
        else if (!Number.isNaN(Number(trimmed))) props.onSave(trimmed);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setEditing(false);
      }}
      className="w-24 rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 text-base font-semibold"
    />
  );
}

function SourceBadge() {
  return (
    <span
      className="rounded-full border border-[var(--border)] px-1.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]"
      title="Imported from Rivian's charging history"
    >
      Rivian
    </span>
  );
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 16 16" className="mr-1.5 inline h-[0.85em] w-[0.85em] -translate-y-px text-[var(--accent)]" fill="currentColor" aria-hidden>
      <path d="M8 1.5 1 7.2l.9 1.1L3 7.4V14h4v-4h2v4h4V7.4l1.1.9.9-1.1L8 1.5Z" />
    </svg>
  );
}

function num(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Where a session's energy went: into the pack, or heating or cooling it. */
function EnergySplit(props: { packKwh: number; thermalKwh: number }) {
  const segments = [
    { key: "pack", label: "Stored", kwh: props.packKwh, color: "var(--series-1)" },
    { key: "thermal", label: "Heating & cooling", kwh: props.thermalKwh, color: "var(--series-2)" },
  ];
  return (
    <div className="mt-4 space-y-2 border-t border-[var(--border)] pt-4">
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="text-[var(--text-secondary)]">Where the energy went</span>
        <span className="tabular-nums">{fmt(props.packKwh + props.thermalKwh, 1)} kWh</span>
      </div>
      <SplitBar segments={segments} />
      <SplitLegend items={segments.map((s) => ({ ...s, kwh: s.kwh }))} />
    </div>
  );
}
