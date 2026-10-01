import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../api/client.js";
import { Panel, StatCard } from "../components/panels.js";
import { TrendChart } from "../components/TrendChart.js";
import { fmt } from "../lib/state.js";

const DRAIN_WINDOWS = [7, 30, 90] as const;

const shortDate = (ms: number) =>
  new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });

export function Health(props: { vehicleId: string }) {
  const [drainDays, setDrainDays] = useState<number>(30);

  const { data: drain } = useQuery({
    queryKey: ["phantomDrain", props.vehicleId, drainDays],
    queryFn: () => api.phantomDrain(props.vehicleId, drainDays),
    refetchInterval: 15 * 60_000,
  });
  const { data: battery } = useQuery({
    queryKey: ["batteryHealth", props.vehicleId],
    queryFn: () => api.batteryHealth(props.vehicleId),
    refetchInterval: 15 * 60_000,
  });

  const drainData = useMemo(
    () =>
      (drain?.days ?? []).map((d) => ({
        ts: Date.parse(`${d.day}T00:00:00Z`),
        rate: d.pctPerDay,
      })),
    [drain],
  );

  const capacityData = useMemo(() => {
    const rows = new Map<number, { ts: number; estimated: number | null; reported: number | null }>();
    for (const e of battery?.estimates ?? []) {
      const ts = Date.parse(e.date);
      rows.set(ts, { ts, estimated: e.estimatedKwh, reported: null });
    }
    for (const r of battery?.reported ?? []) {
      const ts = Date.parse(r.day);
      const row = rows.get(ts) ?? { ts, estimated: null, reported: null };
      row.reported = r.kwh;
      rows.set(ts, row);
    }
    return [...rows.values()].sort((a, b) => a.ts - b.ts);
  }, [battery]);

  const latestEstimate = battery?.estimates.at(-1)?.estimatedKwh ?? null;
  const latestReported = battery?.reported.at(-1)?.kwh ?? null;
  const isLfp = battery?.cellType ? /lfp/i.test(battery.cellType) : false;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Parked drain"
          value={drain?.avgPctPerDay != null ? `${fmt(drain.avgPctPerDay, 2)}%/day` : "—"}
          sub={`Last ${drainDays} days`}
        />
        <StatCard
          label="Est. usable capacity"
          value={latestEstimate != null ? `${fmt(latestEstimate, 0)} kWh` : "—"}
          sub="From your latest long charge"
        />
        <StatCard
          label="Reported capacity"
          value={latestReported != null ? `${fmt(latestReported, 0)} kWh` : "—"}
          sub="As reported by the vehicle"
        />
        <StatCard
          label="Battery cells"
          value={battery?.cellType ?? "—"}
          sub={isLfp ? "LFP: regular charges to 100% are fine" : "As reported by the vehicle"}
        />
      </div>

      <Panel title="Parked battery drain">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-xs text-[var(--text-muted)]">
            Battery lost per day while parked and unplugged. Time spent driving or charging is excluded.
          </p>
          <div className="flex rounded-md border border-[var(--border)] p-0.5">
            {DRAIN_WINDOWS.map((d) => (
              <button
                key={d}
                onClick={() => setDrainDays(d)}
                className={`rounded px-2.5 py-1 text-xs ${
                  d === drainDays
                    ? "bg-[var(--surface-2)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
        {drainData.length > 0 ? (
          <TrendChart
            data={drainData}
            xKey="ts"
            height={200}
            xFormatter={shortDate}
            series={[{ key: "rate", label: "Drain", color: "var(--status-warning)", mark: "bar", unit: "%/day", digits: 2 }]}
          />
        ) : (
          <p className="py-6 text-center text-sm text-[var(--text-muted)]">
            Not enough parked time recorded yet.
          </p>
        )}
      </Panel>

      <Panel title="Battery capacity over time">
        <p className="mb-3 text-xs text-[var(--text-muted)]">
          Each dot estimates usable capacity from a charge that added at least 20%: energy added ÷
          battery % gained. Charging losses and SoC rounding make single sessions noisy; watch the
          trend over months, not one point.
        </p>
        {capacityData.length > 0 ? (
          <TrendChart
            data={capacityData}
            xKey="ts"
            height={220}
            xFormatter={shortDate}
            series={[
              { key: "estimated", label: "Estimated (charging)", color: "var(--series-1)", mark: "line", dots: true, unit: "kWh", digits: 1 },
              { key: "reported", label: "Reported by vehicle", color: "var(--series-2)", mark: "line", unit: "kWh", digits: 1 },
            ]}
          />
        ) : (
          <p className="py-6 text-center text-sm text-[var(--text-muted)]">
            No estimate yet. One appears after a charge that adds at least 20%.
          </p>
        )}
      </Panel>
    </div>
  );
}
