import { BatteryCharging, Gauge, Map, Route, Zap } from "lucide-react";
import { HistoryChart } from "../components/charts/HistoryChart.js";
import { LocationMap } from "../components/maps/LocationMap.js";
import { EmptyOrList } from "../components/ui/EmptyOrList.js";
import { MetricCard } from "../components/ui/MetricCard.js";
import { Panel } from "../components/ui/Panel.js";
import type { AppData, UnitPrefs } from "../types/index.js";
import {
  formatDateTime,
  formatKm,
  formatKwh,
  formatPercent,
  formatRange,
  formatSpeed,
  titleCase,
} from "../utils/formatters.js";

interface OverviewPageProps {
  data: AppData;
  unitPrefs: UnitPrefs;
}

export function OverviewPage({ data, unitPrefs }: OverviewPageProps) {
  const vehicleCollectionDisabled = data.dataQuality?.vehicleCollectionMode === "disabled";

  return (
    <>
      {vehicleCollectionDisabled && (
        <div className="notice">
          Vehicle telemetry collection is disabled. RivianMate can show the connected vehicle, but it will not ingest battery,
          location, charging, or drive data until a safe collection mode is enabled.
        </div>
      )}

      <section className="metricGrid" aria-label="Current vehicle metrics">
        <MetricCard
          label="Battery"
          value={formatPercent(data.overview?.batteryLevel)}
          detail={formatRange(data.overview?.estimatedRangeKm)}
        />
        <MetricCard
          label="Power State"
          value={titleCase(data.overview?.powerState ?? "unknown")}
          detail={data.overview?.chargingState ?? "No charging state"}
        />
        <MetricCard
          label="Speed"
          value={formatSpeed(data.overview?.speedMps)}
          detail={data.overview?.driveMode ?? "No drive mode"}
        />
        <MetricCard
          label="Last Update"
          value={formatDateTime(data.overview?.lastUpdatedAt)}
          detail="Vehicle subscription"
        />
      </section>

      <section className="contentGrid">
        <Panel title="Current Location" icon={<Map size={18} aria-hidden />}>
          <LocationMap
            latitude={data.overview?.latitude ?? null}
            longitude={data.overview?.longitude ?? null}
            lastUpdatedAt={data.overview?.lastUpdatedAt ?? null}
          />
        </Panel>

        <Panel title="Charging Settings" icon={<Zap size={18} aria-hidden />}>
          <dl className="detailsList">
            <div>
              <dt>Charge limit</dt>
              <dd>{formatPercent(data.overview?.chargeLimit)}</dd>
            </div>
            <div>
              <dt>Schedule</dt>
              <dd>{data.overview?.chargeScheduleTime ?? "—"}</dd>
            </div>
            <div>
              <dt>Schedule type</dt>
              <dd>{data.overview?.chargeScheduleType ? titleCase(data.overview.chargeScheduleType.replace(/_/g, " ")) : "—"}</dd>
            </div>
          </dl>
        </Panel>

        <Panel title="Battery History" icon={<BatteryCharging size={18} aria-hidden />}>
          <HistoryChart points={data.history} unitPrefs={unitPrefs} />
        </Panel>

        <Panel title="Recent Drives" icon={<Route size={18} aria-hidden />}>
          <EmptyOrList
            empty="No drives recorded yet."
            items={data.drives
              .slice(0, 5)
              .map((d) => `${formatDateTime(d.startDate)} — ${formatKm(d.distanceKm)}`)}
          />
        </Panel>

        <Panel title="Charging Sessions" icon={<Gauge size={18} aria-hidden />}>
          <EmptyOrList
            empty="No charging sessions recorded yet."
            items={data.charging
              .slice(0, 5)
              .map((s) => `${formatDateTime(s.startDate)} — ${formatKwh(s.energyDeliveredKwh)}`)}
          />
        </Panel>
      </section>
    </>
  );
}
