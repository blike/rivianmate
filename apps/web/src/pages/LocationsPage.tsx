import { Map } from "lucide-react";
import { LocationMap } from "../components/maps/LocationMap.js";
import { Panel } from "../components/ui/Panel.js";
import type { OverviewSnapshot } from "../types/index.js";

interface LocationsPageProps {
  overview: OverviewSnapshot | null;
}

export function LocationsPage({ overview }: LocationsPageProps) {
  return (
    <div className="pageContent">
      <Panel title="Current Location" icon={<Map size={18} aria-hidden />}>
        <LocationMap
          latitude={overview?.latitude ?? null}
          longitude={overview?.longitude ?? null}
          lastUpdatedAt={overview?.lastUpdatedAt ?? null}
        />
      </Panel>
      <div className="notice">
        Full location history and geofences are planned for a future release.
      </div>
    </div>
  );
}
