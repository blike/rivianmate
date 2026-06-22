import { Activity } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchJson } from "../api/client.js";
import { SeverityBadge } from "../components/ui/Badges.js";
import { MetricCard } from "../components/ui/MetricCard.js";
import { Panel } from "../components/ui/Panel.js";
import type { DataQualityEvent, DataQualitySummary } from "../types/index.js";
import { formatDateTime, titleCase } from "../utils/formatters.js";

interface DataQualityPageProps {
  summary: DataQualitySummary | null;
}

export function DataQualityPage({ summary }: DataQualityPageProps) {
  const [events, setEvents] = useState<DataQualityEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);

  useEffect(() => {
    fetchJson<DataQualityEvent[]>("/api/data-quality/events")
      .then(setEvents)
      .catch(() => setEvents([]))
      .finally(() => setLoadingEvents(false));
  }, []);

  return (
    <div className="pageContent">
      <section className="metricGrid">
        <MetricCard
          label="Collector"
          value={titleCase((summary?.collectorStatus ?? "unknown").replace(/_/g, " "))}
          detail="Current status"
        />
        <MetricCard
          label="Last Vehicle Event"
          value={formatDateTime(summary?.lastVehicleEventAt)}
          detail="Subscription"
        />
        <MetricCard
          label="Last Charging Fetch"
          value={formatDateTime(summary?.lastChargingFetchAt)}
          detail="Live session"
        />
        <MetricCard
          label="Raw Events 24h"
          value={String(summary?.rawEventCount24h ?? 0)}
          detail="Ingested events"
        />
      </section>

      <Panel title="Recent Events (24h)" icon={<Activity size={18} aria-hidden />}>
        {loadingEvents ? (
          <div className="notice">Loading events...</div>
        ) : events.length === 0 ? (
          <p className="emptyState">No events in the last 24 hours.</p>
        ) : (
          <table className="dataTable">
            <thead>
              <tr>
                <th>Time</th>
                <th>Category</th>
                <th>Severity</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td>{formatDateTime(event.observedAt)}</td>
                  <td>
                    <code>{event.category}</code>
                  </td>
                  <td>
                    <SeverityBadge value={event.severity} />
                  </td>
                  <td>
                    <code>{event.message}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
