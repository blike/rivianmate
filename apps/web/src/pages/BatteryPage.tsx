import { BatteryCharging } from "lucide-react";
import { HistoryChart } from "../components/charts/HistoryChart.js";
import { Panel } from "../components/ui/Panel.js";
import type { SnapshotHistoryPoint, UnitPrefs } from "../types/index.js";

interface BatteryPageProps {
  history: SnapshotHistoryPoint[];
  unitPrefs: UnitPrefs;
}

export function BatteryPage({ history, unitPrefs }: BatteryPageProps) {
  return (
    <div className="pageContent">
      <Panel
        title="Battery & Range History (last 200 samples)"
        icon={<BatteryCharging size={18} aria-hidden />}
      >
        <HistoryChart points={history} unitPrefs={unitPrefs} />
      </Panel>
      {history.length < 2 && (
        <div className="emptyPage">
          <BatteryCharging size={48} aria-hidden />
          <strong>Building battery history</strong>
          <span>
            Charts appear once enough vehicle-state samples have been collected.
          </span>
        </div>
      )}
    </div>
  );
}
