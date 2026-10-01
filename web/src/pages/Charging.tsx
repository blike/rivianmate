import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, type ChargingSessionDto } from "../api/client.js";
import { useLiveCharging, useUnits } from "../api/hooks.js";
import { Panel, Row, StatCard } from "../components/panels.js";
import { SchedulesPanel } from "../components/SchedulesPanel.js";
import { TrendChart } from "../components/TrendChart.js";
import { fmt, fmtDuration, titleCase } from "../lib/state.js";

export function Charging(props: { vehicleId: string }) {
  const queryClient = useQueryClient();
  const { data: live } = useLiveCharging(props.vehicleId);
  const u = useUnits();

  const { data: sessions } = useQuery({
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

  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const curveSession =
    sessions?.find((s) => s.id === selectedSessionId) ?? sessions?.[0];
  const { data: curve } = useQuery({
    queryKey: ["chargingCurve", curveSession?.id],
    queryFn: () => api.chargingCurve(curveSession!.id),
    enabled: curveSession != null,
    refetchInterval: curveSession && !curveSession.endedAt ? 30_000 : false,
  });
  const curveData = useMemo(() => {
    const first = curve?.[0] ? Date.parse(curve[0].ts) : 0;
    return (curve ?? []).map((p) => ({
      minutes: (Date.parse(p.ts) - first) / 60_000,
      power: p.powerKw,
      soc: p.soc,
    }));
  }, [curve]);

  return (
    <div className="space-y-4">
      {isLive && live && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Power" value={`${fmt(num(live.power?.value), 1)} kW`} />
          <StatCard label="State of charge" value={`${fmt(num(live.soc?.value), 0)}%`} />
          <StatCard
            label="Energy added"
            value={`${fmt(num(live.totalChargedEnergy?.value), 1)} kWh`}
          />
          <StatCard
            label="Time remaining"
            value={
              live.timeRemaining?.value != null
                ? `${fmt(num(live.timeRemaining.value)! / 60, 0)} min`
                : "—"
            }
          />
        </div>
      )}

      <SchedulesPanel vehicleId={props.vehicleId} />

      <Panel title="Charging sessions">
        {!sessions?.length ? (
          <p className="py-6 text-center text-sm text-[var(--text-muted)]">
            No charging sessions recorded yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] text-sm">
              <thead className="text-left text-xs text-[var(--text-muted)]">
                <tr>
                  <th className="pb-2 font-normal">Started</th>
                  <th className="pb-2 font-normal">Duration</th>
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
                      {!s.endedAt && (
                        <span className="ml-2 text-xs text-[var(--status-good)]">
                          charging
                        </span>
                      )}
                    </td>
                    <td className="py-2">{fmtDuration(s.startedAt, s.endedAt)}</td>
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
                      {s.startSoc != null && s.endSoc != null
                        ? `${fmt(s.startSoc, 0)}→${fmt(s.endSoc, 0)}%`
                        : "—"}
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
                        currency={s.currency}
                        onSave={(cost) => costMutation.mutate({ id: s.id, cost })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {curveSession && (
        <Panel
          title={`Charging curve · ${new Date(curveSession.startedAt).toLocaleString([], {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}`}
        >
          {curveData.length > 1 ? (
            <TrendChart
              data={curveData}
              xKey="minutes"
              height={240}
              xFormatter={(m) => `${fmt(m, curveData.at(-1)!.minutes < 10 ? 1 : 0)} min`}
              rightDomain={[0, 100]}
              series={[
                { key: "power", label: "Power", color: "var(--series-1)", unit: "kW" },
                { key: "soc", label: "Battery", color: "var(--accent)", mark: "line", right: true, unit: "%", digits: 0 },
              ]}
            />
          ) : (
            <p className="py-6 text-center text-sm text-[var(--text-muted)]">
              No curve recorded for this session. Curves are kept for sessions charged
              while RivianMate was running.
            </p>
          )}
        </Panel>
      )}

      {wallboxes && wallboxes.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {wallboxes.map((wb) => (
            <Panel key={wb.wallboxId} title={wb.name ?? wb.wallboxId}>
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
          ))}
        </div>
      )}
    </div>
  );
}

function CostCell(props: {
  cost: string | null;
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
        {props.cost != null
          ? `${props.currency === "USD" || !props.currency ? "$" : `${props.currency} `}${fmt(Number(props.cost), 2)}`
          : "add"}
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

function chargerLabel(s: ChargingSessionDto): string {
  if (s.chargerType === "rivian_charger") return "Rivian Adventure Network";
  if (s.chargerType === "wallbox") return "Home";
  if (s.vendor) return titleCase(s.vendor.toLowerCase());
  return s.chargerId ?? titleCase(s.chargerType);
}
