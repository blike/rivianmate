import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { api, type ChargingSessionDto, type WallboxDto } from "../api/client.js";
import { useLiveCharging, useUnits, useVehicleState } from "../api/hooks.js";
import { ContentFrame, LoadingScope, SkeletonRows } from "../components/loading.js";
import { Panel, Row, StatCard } from "../components/panels.js";
import { SchedulesPanel } from "../components/SchedulesPanel.js";
import { TrendChart } from "../components/TrendChart.js";
import { chargingSecondsNow, socRange } from "../lib/charging.js";
import { fmt, fmtDuration, fmtSeconds, sv, titleCase } from "../lib/state.js";
import { useRemainingHeight } from "../lib/useRemainingHeight.js";

export function Charging(props: { vehicleId: string }) {
  const queryClient = useQueryClient();
  const { data: live } = useLiveCharging(props.vehicleId);
  const { data: state } = useVehicleState(props.vehicleId);
  const u = useUnits();

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
    mutationFn: ({ id, cost }: { id: number; cost: string | null }) =>
      api.updateSessionCost(id, cost),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["chargingSessions", props.vehicleId],
      }),
  });

  const isLive = live?.vehicleChargerState?.value === "charging_active";
  // The live session arrives over SSE just after the page loads; if the
  // vehicle state already says it's charging, hold its place meanwhile.
  const liveExpected =
    live === undefined && sv(state, "chargerStatus") === "chrgr_sts_connected_charging";

  // The sessions table fills the rest of the screen and scrolls inside;
  // the gap leaves room for the panel's padding and the page's bottom margin.
  const sessionsRef = useRef<HTMLDivElement>(null);
  const sessionsHeight = useRemainingHeight(sessionsRef, 58, 0.4);

  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const curveSession =
    sessions?.find((s) => s.id === selectedSessionId) ?? sessions?.[0];
  const showCurve = sessionsPending || curveSession != null;
  const {
    data: curve,
    isPending: curvePending,
    isPlaceholderData: showingPreviousCurve,
  } = useQuery({
    queryKey: ["chargingCurve", curveSession?.id],
    queryFn: () => api.chargingCurve(curveSession!.id),
    enabled: curveSession != null,
    refetchInterval: curveSession && !curveSession.endedAt ? 30_000 : false,
    // Keep the previous curve on screen (dimmed) while the next one loads.
    placeholderData: keepPreviousData,
  });
  // Minutes since plug-in (or the first point, if earlier).
  const curveData = useMemo(() => {
    const points = curve ?? [];
    const plugIn = curveSession ? Date.parse(curveSession.startedAt) : Number.POSITIVE_INFINITY;
    const origin = Math.min(plugIn, points[0] ? Date.parse(points[0].ts) : plugIn);
    return points.map((p) => ({
      minutes: (Date.parse(p.ts) - origin) / 60_000,
      power: p.powerKw,
      soc: p.soc,
    }));
  }, [curve, curveSession]);
  // Without power, the curve is battery level from recorded vehicle state.
  const curveHasPower = curveData.some((p) => p.power != null);
  const curveMinutes = curveData.at(-1)?.minutes ?? 0;
  const formatCurveTime = (m: number) =>
    curveMinutes >= 120 ? fmtSeconds(m * 60) : `${fmt(m, curveMinutes < 10 ? 1 : 0)} min`;

  return (
    <div className="space-y-4">
      {(isLive || liveExpected) && (
        <LoadingScope loading={!isLive}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Power" value={`${fmt(num(live?.power?.value), 1)} kW`} />
            <StatCard label="State of charge" value={`${fmt(num(live?.soc?.value), 0)}%`} />
            <StatCard
              label="Energy added"
              value={`${fmt(num(live?.totalChargedEnergy?.value), 1)} kWh`}
            />
            <StatCard
              label="Time remaining"
              value={
                live?.timeRemaining?.value != null
                  ? `${fmt(num(live.timeRemaining.value)! / 60, 0)} min`
                  : "—"
              }
            />
          </div>
        </LoadingScope>
      )}

      <div
        className={
          showCurve
            ? "grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,13fr)]"
            : "space-y-4"
        }
      >
        {/* Stretches to the curve's height, so the row's height stays put. */}
        <div className="flex flex-col gap-4">
          <SchedulesPanel vehicleId={props.vehicleId} className="flex-1" />
          {wallboxes && wallboxes.length > 0 && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-1">
              {wallboxes.map((wb) => (
                <WallboxPanel key={wb.wallboxId} wallbox={wb} />
              ))}
            </div>
          )}
        </div>
        {showCurve && (
          <Panel
            title={
              curveSession
                ? `Charging curve · ${new Date(curveSession.startedAt).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}`
                : "Charging curve"
            }
          >
            <div className={`transition-opacity ${showingPreviousCurve ? "opacity-50" : ""}`}>
              <ContentFrame
                height={240}
                loading={sessionsPending || curvePending}
                empty={curveData.length <= 1}
                emptyText="No charging data for this session: Rivian didn't provide a power curve, and RivianMate wasn't recording while it charged."
              >
                {curveHasPower ? (
                  <TrendChart
                    data={curveData}
                    xKey="minutes"
                    height={240}
                    xFormatter={formatCurveTime}
                    rightDomain={[0, 100]}
                    series={[
                      { key: "power", label: "Power", color: "var(--series-1)", unit: "kW" },
                      { key: "soc", label: "Battery", color: "var(--accent)", mark: "line", right: true, unit: "%", digits: 0 },
                    ]}
                  />
                ) : (
                  <TrendChart
                    data={curveData}
                    xKey="minutes"
                    height={240}
                    xFormatter={formatCurveTime}
                    leftDomain={[0, 100]}
                    series={[
                      { key: "soc", label: "Battery", color: "var(--accent)", mark: "line", unit: "%", digits: 0, dots: true },
                    ]}
                  />
                )}
              </ContentFrame>
              {/* Room for both notes, so the panel keeps its height between sessions. */}
              <div className="mt-2 min-h-9 space-y-1 text-xs text-[var(--text-muted)]">
                {curveSession?.packKwh != null && curveSession.thermalKwh != null && (
                  <p>
                    {fmt(curveSession.packKwh, 1)} kWh went into the battery
                    {curveSession.thermalKwh >= 0.05
                      ? ` and ${fmt(curveSession.thermalKwh, 1)} kWh to heating or cooling it.`
                      : "."}
                  </p>
                )}
                {!curveHasPower && curveData.length > 1 && (
                  <p>
                    Battery level from recorded vehicle state. Rivian didn't provide power data for this
                    session.
                  </p>
                )}
              </div>
            </div>
          </Panel>
        )}
      </div>

      <Panel title="Charging sessions">
        <div ref={sessionsRef} className="overflow-auto" style={{ maxHeight: sessionsHeight }}>
          {sessionsPending ? (
            <SkeletonRows rows={6} />
          ) : !sessions?.length ? (
            <p className="py-6 text-center text-sm text-[var(--text-muted)]">
              No charging sessions recorded yet.
            </p>
          ) : (
            <table className="w-full min-w-[42rem] text-sm">
                <thead className="sticky top-0 z-10 bg-[var(--surface-1)] text-left text-xs text-[var(--text-muted)]">
                  <tr>
                    <th className="pb-2 font-normal">Started</th>
                    <th className="pb-2 font-normal">Plugged in</th>
                    <th className="pb-2 font-normal">Charger</th>
                    <th className="pb-2 text-right font-normal">SOC</th>
                    <th className="pb-2 text-right font-normal">Energy</th>
                    <th className="pb-2 text-right font-normal">Range added</th>
                    <th className="pb-2 text-right font-normal">Peak</th>
                    <th className="pb-2 text-right font-normal">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => setSelectedSessionId(s.id)}
                      className={`cursor-pointer border-t border-[var(--border)] hover:bg-[var(--surface-2)] ${
                        curveSession?.id === s.id ? "bg-[var(--surface-2)]" : ""
                      }`}
                    >
                      <td className="py-2">
                        {new Date(s.startedAt).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {!s.endedAt &&
                          (s.chargingSince ? (
                            <span className="ml-2 text-xs text-[var(--status-good)]">charging</span>
                          ) : (
                            <span className="ml-2 text-xs text-[var(--text-muted)]">plugged in</span>
                          ))}
                      </td>
                      <td className="py-2">
                        <div className="tabular-nums">{fmtDuration(s.startedAt, s.endedAt)}</div>
                        <ChargingTime session={s} />
                      </td>
                      <td className="py-2">
                        <div className="flex items-center gap-2">
                          <span>{chargerLabel(s)}</span>
                          {s.source === "rivian" && (
                            <span
                              className="rounded-full border border-[var(--border)] px-1.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]"
                              title="Imported from Rivian's charging history"
                            >
                              Rivian
                            </span>
                          )}
                        </div>
                        {s.city && (
                          <div className="text-xs text-[var(--text-muted)]">{s.city}</div>
                        )}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {socRange(s.startSoc, s.endSoc)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {s.energyKwh != null ? `${fmt(s.energyKwh, 1)} kWh` : "—"}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {u.formatDistance(s.rangeAddedKm)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {s.maxPowerKw != null ? `${fmt(s.maxPowerKw, 1)} kW` : "—"}
                      </td>
                      <td className="py-2 text-right">
                        <CostCell
                          cost={s.cost}
                          estimatedCost={s.estimatedCost}
                          currency={s.currency}
                          onSave={(cost) => costMutation.mutate({ id: s.id, cost })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
          )}
        </div>
      </Panel>

    </div>
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
          value={
            wb.latest?.power != null
              ? `${fmt(wb.latest.power, 1)} kW / ${fmt(wb.maxPower, 1)} kW`
              : "—"
          }
        />
        <Row
          label="Output"
          value={
            wb.latest?.currentAmps != null
              ? `${fmt(wb.latest.currentAmps, 0)} A @ ${fmt(wb.latest.currentVoltage, 0)} V`
              : "—"
          }
        />
        <Row label="Model" value={wb.model ?? "—"} />
        <Row label="Firmware" value={wb.softwareVersion ?? "—"} />
      </dl>
    </Panel>
  );
}

/** Time actually charging within the plug-in, when RivianMate watched it. */
function ChargingTime(props: { session: ChargingSessionDto }) {
  const seconds = chargingSecondsNow(props.session);
  if (seconds == null) return null;
  return (
    <div className="text-xs tabular-nums text-[var(--text-muted)]">{fmtSeconds(seconds)} charging</div>
  );
}

function CostCell(props: {
  cost: string | null;
  estimatedCost?: string | null;
  currency: string | null;
  onSave: (cost: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(props.cost ?? "");

  if (!editing) {
    return (
      <button
        className="tabular-nums text-[var(--text-secondary)] underline decoration-dotted underline-offset-2 hover:text-[var(--text-primary)]"
        onClick={() => {
          setValue(props.cost ?? "");
          setEditing(true);
        }}
        title="Edit cost"
      >
        {props.cost != null ? (
          formatMoney(props.cost, props.currency)
        ) : props.estimatedCost != null ? (
          <span className="text-[var(--text-muted)]" title="Estimated from your home electricity rate">
            ≈ {formatMoney(props.estimatedCost, props.currency)}
          </span>
        ) : (
          "add"
        )}
      </button>
    );
  }
  return (
    <input
      autoFocus
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
      className="w-20 rounded border border-[var(--border)] bg-[var(--surface-2)] px-1 py-0.5 text-right text-sm"
    />
  );
}

function num(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatMoney(amount: string, currency: string | null): string {
  const prefix = currency === "USD" || !currency ? "$" : `${currency} `;
  return `${prefix}${fmt(Number(amount), 2)}`;
}

function chargerLabel(s: ChargingSessionDto): string {
  if (s.chargerType === "rivian_charger") return "Rivian Adventure Network";
  if (s.isHome) return "Home";
  if (s.vendor) return titleCase(s.vendor.toLowerCase());
  return s.chargerId ?? titleCase(s.chargerType);
}
