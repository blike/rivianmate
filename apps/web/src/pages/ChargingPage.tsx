import { ChevronLeft, Database, PlugZap } from "lucide-react";
import { useState } from "react";
import { fetchJson } from "../api/client.js";
import { ChargingCurveChart } from "../components/charts/ChargingCurveChart.js";
import { ConfidenceBadge } from "../components/ui/Badges.js";
import { MetricCard } from "../components/ui/MetricCard.js";
import { Panel } from "../components/ui/Panel.js";
import type { ChargingSessionDetail, ChargingSessionSummary } from "../types/index.js";
import {
  formatDateTime,
  formatDuration,
  formatKm,
  formatKwh,
  formatPercent,
  titleCase,
} from "../utils/formatters.js";

interface ChargingPageProps {
  sessions: ChargingSessionSummary[];
}

export function ChargingPage({ sessions }: ChargingPageProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ChargingSessionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openSession(id: string) {
    setSelectedId(id);
    setLoading(true);
    setError(null);
    try {
      setDetail(await fetchJson<ChargingSessionDetail>(`/api/charging-sessions/${id}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load session.");
    } finally {
      setLoading(false);
    }
  }

  function close() {
    setSelectedId(null);
    setDetail(null);
  }

  if (selectedId) {
    return (
      <div className="pageContent">
        <button className="backLink" onClick={close}>
          <ChevronLeft size={16} /> Back to charging
        </button>
        {loading && <div className="notice">Loading session...</div>}
        {error && <div className="notice error">{error}</div>}
        {detail && <ChargingDetailView session={detail} />}
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="pageContent">
        <div className="emptyPage">
          <PlugZap size={48} aria-hidden />
          <strong>No charging sessions recorded yet</strong>
          <span>Sessions appear once the collector detects a plugged-in state.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="pageContent">
      <table className="dataTable">
        <thead>
          <tr>
            <th>Date</th>
            <th>Energy</th>
            <th>Range Added</th>
            <th>Start SoC</th>
            <th>Cost</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr
              key={s.id}
              className="clickableRow"
              onClick={() => void openSession(s.id)}
            >
              <td>{formatDateTime(s.startDate)}</td>
              <td>{formatKwh(s.energyDeliveredKwh)}</td>
              <td>{s.rangeAddedKm != null ? formatKm(s.rangeAddedKm) : "—"}</td>
              <td>—</td>
              <td>
                {s.cost != null ? `${s.cost.toFixed(2)} ${s.currency ?? ""}` : "—"}
              </td>
              <td>
                {s.endDate ? "Complete" : <span className="activeBadge active">Active</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Detail view ───────────────────────────────────────────────────────────────

function ChargingDetailView({ session }: { session: ChargingSessionDetail }) {
  const duration =
    session.endDate
      ? Math.round(
          (new Date(session.endDate).getTime() - new Date(session.startDate).getTime()) / 1000
        )
      : null;

  return (
    <div className="detailPage">
      <section className="metricGrid" aria-label="Session summary">
        <MetricCard
          label="Energy"
          value={formatKwh(session.energyDeliveredKwh)}
          detail={formatDateTime(session.startDate)}
        />
        <MetricCard
          label="Range Added"
          value={session.rangeAddedKm != null ? formatKm(session.rangeAddedKm) : "—"}
          detail="Estimated"
        />
        <MetricCard
          label="Peak Power"
          value={
            session.peakPowerKw != null ? `${session.peakPowerKw.toFixed(1)} kW` : "—"
          }
          detail="Peak charging rate"
        />
        <MetricCard
          label="Duration"
          value={formatDuration(duration)}
          detail={session.endDate ? "Complete" : "In progress"}
        />
      </section>

      {session.samples.length >= 2 && (
        <Panel title="Charging Curve" icon={<PlugZap size={18} aria-hidden />}>
          <ChargingCurveChart samples={session.samples} />
        </Panel>
      )}

      <Panel title="Session Details" icon={<Database size={18} aria-hidden />}>
        <dl className="detailsList">
          <div>
            <dt>Start SoC</dt>
            <dd>{formatPercent(session.startBatteryLevel)}</dd>
          </div>
          <div>
            <dt>End SoC</dt>
            <dd>{formatPercent(session.endBatteryLevel)}</dd>
          </div>
          <div>
            <dt>Cost</dt>
            <dd>
              {session.cost != null
                ? `${session.cost.toFixed(2)} ${session.currency ?? ""}`
                : "—"}
            </dd>
          </div>
          <div>
            <dt>Confidence</dt>
            <dd>
              <ConfidenceBadge value={session.confidence} />
            </dd>
          </div>
          <div>
            <dt>Samples</dt>
            <dd>{session.samples.length}</dd>
          </div>
        </dl>
      </Panel>
    </div>
  );
}
