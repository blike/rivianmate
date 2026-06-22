import { BatteryCharging, Database, Gauge, Map, Route } from "lucide-react";
import { HistoryChart } from "../components/charts/HistoryChart.js";
import { LocationMap } from "../components/maps/LocationMap.js";
import { EmptyOrList } from "../components/ui/EmptyOrList.js";
import { MetricCard } from "../components/ui/MetricCard.js";
import { Panel } from "../components/ui/Panel.js";
import { RivianConnectedPanel } from "../screens/RivianConnectedPanel.js";
import { RivianCredentialPanel } from "../screens/RivianCredentialPanel.js";
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
  onRefresh: () => void;
}

export function OverviewPage({ data, unitPrefs, onRefresh }: OverviewPageProps) {
  return (
    <>
      {data.rivianCredentials &&
        (data.rivianCredentials.configured ? (
          <RivianConnectedPanel email={data.rivianCredentials.email} onDiscover={onRefresh} />
        ) : (
          <RivianCredentialPanel onComplete={onRefresh} />
        ))}

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

        <Panel title="Collector Health" icon={<Database size={18} aria-hidden />}>
          <dl className="detailsList">
            <div>
              <dt>Vehicle events</dt>
              <dd>{formatDateTime(data.dataQuality?.lastVehicleEventAt)}</dd>
            </div>
            <div>
              <dt>Charging fetch</dt>
              <dd>{formatDateTime(data.dataQuality?.lastChargingFetchAt)}</dd>
            </div>
            <div>
              <dt>Raw events, 24h</dt>
              <dd>{data.dataQuality?.rawEventCount24h ?? 0}</dd>
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
