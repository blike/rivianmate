import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../api/client.js";
import { useUnits } from "../api/hooks.js";
import { ContentFrame, LoadingScope } from "../components/loading.js";
import { Panel, StatCard } from "../components/panels.js";
import { TrendChart } from "../components/TrendChart.js";
import { ParkedEnergyPanel } from "../components/InsightsPanels.js";
import { SoftwarePanel } from "../components/SoftwarePanel.js";
import { fmt } from "../lib/state.js";

const WINDOWS = [7, 30, 90] as const;

const shortDate = (ms: number) =>
  new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });

export function Health(props: { vehicleId: string }) {
  const [tireDays, setTireDays] = useState<number>(30);
  const u = useUnits();

  // Window changes keep the previous chart until the new one loads.
  const { data: insights, isPending: insightsPending, isError: insightsError } = useQuery({
    queryKey: ["insights", props.vehicleId],
    queryFn: () => api.insights(props.vehicleId),
    refetchInterval: 60_000,
  });
  const { data: tires, isPending: tiresPending } = useQuery({
    queryKey: ["tirePressures", props.vehicleId, tireDays],
    queryFn: () => api.tirePressures(props.vehicleId, tireDays),
    refetchInterval: 15 * 60_000,
    placeholderData: keepPreviousData,
  });
  const { data: battery, isPending: batteryPending, isError: batteryError } = useQuery({
    queryKey: ["batteryHealth", props.vehicleId],
    queryFn: () => api.batteryHealth(props.vehicleId),
    refetchInterval: 60_000,
  });

  const tireData = useMemo(
    () =>
      (tires ?? []).map((t) => ({
        ts: Date.parse(t.ts),
        fl: u.pressure(t.frontLeft),
        fr: u.pressure(t.frontRight),
        rl: u.pressure(t.rearLeft),
        rr: u.pressure(t.rearRight),
      })),
    [tires, u],
  );

  const capacityData = useMemo(() => (battery?.reported ?? []).map(r => ({
    ts: Date.parse(r.at), reported: r.kwh,
  })), [battery]);
  const latestReported = battery?.latest ?? null;
  const parkedDay = insights?.parkedEnergy?.windows.find(w => w.minutes === 1440);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <LoadingScope loading={insightsPending}>
          <StatCard
            label="Parked energy · 24h"
            value={parkedDay ? `${fmt(parkedDay.kwh, 1)} kWh` : "—"}
            sub={parkedDay && insights?.parkedEnergy ? `Reported ${new Date(insights.parkedEnergy.at).toLocaleString()}` : "Awaiting a 24-hour vehicle report"}
          />
        </LoadingScope>
        <LoadingScope loading={batteryPending}>
          <StatCard
            label="Reported capacity"
            value={latestReported != null ? `${fmt(latestReported.kwh, 1)} kWh` : "—"}
            sub={latestReported ? `Reported ${new Date(latestReported.at).toLocaleString()}` : "Awaiting vehicle report"}
          />
          <StatCard
            label="Rated capacity"
            value={battery?.ratedCapacity ? `${fmt(battery.ratedCapacity.kwh, 1)} kWh` : "—"}
            sub="Vehicle-reported rated pack size"
          />
        </LoadingScope>
      </div>

      {(batteryError || insightsError) && <p role="alert" className="text-sm text-[var(--status-critical)]">Could not refresh vehicle health readings. Existing values may be out of date.</p>}
      <Panel title="Parked energy use">
        <p className="mb-3 text-xs text-[var(--text-muted)]">Energy used while parked, as reported by Rivian for each window. Overlapping windows are shown separately.</p>
        <LoadingScope loading={insightsPending}>
          <ParkedEnergyPanel insights={insights} />
        </LoadingScope>
        {insights?.parkedEnergy && <p className="mt-3 text-xs text-[var(--text-muted)]">Last reported {new Date(insights.parkedEnergy.at).toLocaleString()}</p>}
      </Panel>

      <Panel title="Battery capacity over time">
        <p className="mb-3 text-xs text-[var(--text-muted)]">
          The last recorded vehicle capacity reading each day (UTC), in kWh. Values are the vehicle’s
          own estimates and can fluctuate; this is not a degradation percentage.
        </p>
        <ContentFrame
          height={220}
          loading={batteryPending}
          empty={capacityData.length === 0}
          emptyText="No vehicle-reported capacity readings recorded yet."
        >
          <TrendChart
            data={capacityData}
            xKey="ts"
            height={220}
            xFormatter={shortDate}
            tooltipLabel={(ms) => new Date(ms).toLocaleString()}
            series={[
              { key: "reported", label: "Reported by vehicle", color: "var(--series-2)", mark: "line", dots: true, unit: "kWh", digits: 1 },
            ]}
          />
        </ContentFrame>
      </Panel>
      <Panel title="Tire pressure">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-xs text-[var(--text-muted)]">
            A tire that keeps drifting below the others usually has a slow leak.
          </p>
          <WindowPicker value={tireDays} onChange={setTireDays} />
        </div>
        <ContentFrame
          height={220}
          loading={tiresPending}
          empty={tireData.length === 0}
          emptyText="No tire pressure readings in this window yet."
        >
          <TrendChart
            data={tireData}
            xKey="ts"
            height={220}
            xFormatter={shortDate}
            tooltipLabel={(ms) => new Date(ms).toLocaleString()}
            series={[
              { key: "fl", label: "Front left", color: "var(--series-1)", mark: "line", unit: u.pressureUnit, digits: u.pressureUnit === "psi" ? 1 : 2 },
              { key: "fr", label: "Front right", color: "var(--series-2)", mark: "line", unit: u.pressureUnit, digits: u.pressureUnit === "psi" ? 1 : 2 },
              { key: "rl", label: "Rear left", color: "var(--accent)", mark: "line", unit: u.pressureUnit, digits: u.pressureUnit === "psi" ? 1 : 2 },
              { key: "rr", label: "Rear right", color: "var(--status-critical)", mark: "line", unit: u.pressureUnit, digits: u.pressureUnit === "psi" ? 1 : 2 },
            ]}
          />
        </ContentFrame>
      </Panel>

      <SoftwarePanel vehicleId={props.vehicleId} />
    </div>
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
