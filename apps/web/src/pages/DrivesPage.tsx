import { ChevronLeft, Map, Route } from "lucide-react";
import { useState } from "react";
import { fetchJson } from "../api/client.js";
import { LeafletMap } from "../components/maps/LeafletMap.js";
import { ConfidenceBadge } from "../components/ui/Badges.js";
import { MetricCard } from "../components/ui/MetricCard.js";
import { Panel } from "../components/ui/Panel.js";
import type { DriveDetail, DriveSummary, UnitPrefs } from "../types/index.js";
import {
  formatDateTime,
  formatDistance,
  formatDuration,
  formatPercent,
  titleCase,
} from "../utils/formatters.js";

interface DrivesPageProps {
  drives: DriveSummary[];
  unitPrefs: UnitPrefs;
}

export function DrivesPage({ drives, unitPrefs }: DrivesPageProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DriveDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openDrive(id: string) {
    setSelectedId(id);
    setLoading(true);
    setError(null);
    try {
      setDetail(await fetchJson<DriveDetail>(`/api/drives/${id}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load drive.");
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
          <ChevronLeft size={16} /> Back to drives
        </button>
        {loading && <div className="notice">Loading drive...</div>}
        {error && <div className="notice error">{error}</div>}
        {detail && <DriveDetailView drive={detail} unitPrefs={unitPrefs} />}
      </div>
    );
  }

  if (drives.length === 0) {
    return (
      <div className="pageContent">
        <div className="emptyPage">
          <Route size={48} aria-hidden />
          <strong>No drives recorded yet</strong>
          <span>Drives appear here once the collector detects movement.</span>
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
            <th>Distance</th>
            <th>Duration</th>
            <th>Start SoC</th>
            <th>End SoC</th>
            <th>Confidence</th>
          </tr>
        </thead>
        <tbody>
          {drives.map((drive) => (
            <tr
              key={drive.id}
              className="clickableRow"
              onClick={() => void openDrive(drive.id)}
            >
              <td>{formatDateTime(drive.startDate)}</td>
              <td>{formatDistance(drive.distanceKm, unitPrefs)}</td>
              <td>{formatDuration(drive.durationSeconds)}</td>
              <td>{formatPercent(drive.startBatteryLevel)}</td>
              <td>{formatPercent(drive.endBatteryLevel)}</td>
              <td>
                <ConfidenceBadge value={drive.confidence} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Detail view ───────────────────────────────────────────────────────────────

interface DriveDetailViewProps {
  drive: DriveDetail;
  unitPrefs: UnitPrefs;
}

function DriveDetailView({ drive, unitPrefs }: DriveDetailViewProps) {
  const hasRoute = drive.positions.length >= 2;

  return (
    <div className="detailPage">
      <section className="metricGrid" aria-label="Drive summary">
        <MetricCard
          label="Distance"
          value={formatDistance(drive.distanceKm, unitPrefs)}
          detail={formatDuration(drive.durationSeconds)}
        />
        <MetricCard
          label="Start"
          value={formatPercent(drive.startBatteryLevel)}
          detail={formatDateTime(drive.startDate)}
        />
        <MetricCard
          label="End"
          value={formatPercent(drive.endBatteryLevel)}
          detail={formatDateTime(drive.endDate)}
        />
        <MetricCard
          label="Confidence"
          value={titleCase(drive.confidence)}
          detail={`${drive.positions.length} position samples`}
        />
      </section>

      <Panel title="Route" icon={<Map size={18} aria-hidden />}>
        {hasRoute ? (
          <LeafletMap positions={drive.positions} />
        ) : (
          <div className="mapSurface emptyMap">
            <div>
              <strong>No route data</strong>
              <span>No position samples were recorded for this drive.</span>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
