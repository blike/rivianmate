import { Activity, Battery, Cpu, Gauge } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchJson } from "../api/client.js";
import { HealthBadge, StateBadge, TireBadge } from "../components/ui/Badges.js";
import { MetricCard } from "../components/ui/MetricCard.js";
import { Panel } from "../components/ui/Panel.js";
import type { VehicleHealthSnapshot, VehicleStateInterval } from "../types/index.js";
import { formatDateTime, formatDuration } from "../utils/formatters.js";

interface HealthPageProps {
  vehicleId: string | null;
}

export function HealthPage({ vehicleId }: HealthPageProps) {
  const [health, setHealth] = useState<VehicleHealthSnapshot | null>(null);
  const [states, setStates] = useState<VehicleStateInterval[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!vehicleId) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    Promise.all([
      fetchJson<VehicleHealthSnapshot>(`/api/vehicles/${vehicleId}/health-snapshot`),
      fetchJson<VehicleStateInterval[]>(`/api/vehicles/${vehicleId}/states`),
    ])
      .then(([h, s]) => {
        if (!cancelled) {
          setHealth(h);
          setStates(s);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHealth(null);
          setStates([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [vehicleId]);

  if (!vehicleId) {
    return (
      <div className="pageContent">
        <div className="notice">No vehicle selected.</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="pageContent">
        <div className="notice">Loading health data...</div>
      </div>
    );
  }

  const noSignals =
    !health ||
    (!health.tirePressureFrontLeft &&
      !health.twelveVoltBatteryHealth &&
      !health.otaCurrentVersion);

  return (
    <div className="pageContent">
      {/* Tire pressure */}
      <Panel title="Tire Pressure" icon={<Gauge size={18} aria-hidden />}>
        {noSignals ? (
          <div className="notice">
            Tire pressure data not yet available. The collector will populate this once the
            subscription includes tire pressure fields.
          </div>
        ) : (
          <div className="tireGrid">
            <TireCell label="Front Left" status={health?.tirePressureFrontLeft ?? null} />
            <TireCell label="Front Right" status={health?.tirePressureFrontRight ?? null} />
            <TireCell label="Rear Left" status={health?.tirePressureRearLeft ?? null} />
            <TireCell label="Rear Right" status={health?.tirePressureRearRight ?? null} />
          </div>
        )}
      </Panel>

      {/* 12V battery */}
      <Panel title="12V Battery" icon={<Battery size={18} aria-hidden />}>
        {noSignals ? (
          <div className="notice">
            12V battery health not yet available. Data populates automatically from the vehicle
            subscription.
          </div>
        ) : (
          <div className="metricGrid">
            <MetricCard
              label="Health"
              value={
                health?.twelveVoltBatteryHealth ? (
                  <HealthBadge
                    value={health.twelveVoltBatteryHealth}
                    ok={health.twelveVoltBatteryHealth.toLowerCase() === "normal"}
                  />
                ) : (
                  "—"
                )
              }
              detail="12V auxiliary battery"
            />
          </div>
        )}
      </Panel>

      {/* OTA updates */}
      <Panel title="Software / OTA" icon={<Cpu size={18} aria-hidden />}>
        {noSignals ? (
          <div className="notice">
            OTA update data not yet available. It will appear once the vehicle reports software
            version information.
          </div>
        ) : (
          <div className="metricGrid">
            <MetricCard
              label="Current Version"
              value={health?.otaCurrentVersion ?? "—"}
              detail="Installed firmware"
            />
            <MetricCard
              label="Available Version"
              value={health?.otaAvailableVersion ?? "—"}
              detail={
                health?.otaAvailableVersion &&
                health?.otaCurrentVersion &&
                health.otaAvailableVersion !== health.otaCurrentVersion
                  ? "Update available"
                  : "Up to date"
              }
            />
            {health?.otaInstallReady != null && (
              <MetricCard
                label="Install Ready"
                value={
                  <HealthBadge
                    value={health.otaInstallReady ? "Ready" : "Not ready"}
                    ok={health.otaInstallReady}
                  />
                }
                detail="Pending OTA install"
              />
            )}
            {health?.otaInstallDuration != null && (
              <MetricCard
                label="Est. Install Time"
                value={formatDuration(health.otaInstallDuration)}
                detail="OTA installation"
              />
            )}
          </div>
        )}
      </Panel>

      {/* State intervals */}
      {states.length > 0 && (
        <Panel title="Vehicle State History" icon={<Activity size={18} aria-hidden />}>
          <table className="dataTable">
            <thead>
              <tr>
                <th>State</th>
                <th>Started</th>
                <th>Ended</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {states.map((interval) => {
                const durationSec =
                  interval.endedAt
                    ? Math.round(
                        (new Date(interval.endedAt).getTime() -
                          new Date(interval.startedAt).getTime()) /
                          1000
                      )
                    : null;
                return (
                  <tr key={interval.id}>
                    <td>
                      <StateBadge state={interval.state} active={!interval.endedAt} />
                    </td>
                    <td>{formatDateTime(interval.startedAt)}</td>
                    <td>{interval.endedAt ? formatDateTime(interval.endedAt) : "—"}</td>
                    <td>{durationSec != null ? formatDuration(durationSec) : "Ongoing"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}

function TireCell({ label, status }: { label: string; status: string | null }) {
  return (
    <div className="tireCell">
      <span className="tireCellLabel">{label}</span>
      <TireBadge status={status} />
    </div>
  );
}
