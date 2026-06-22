import { useState } from "react";
import { postJson } from "../../api/client.js";
import type { VehicleSummary } from "../../types/index.js";

interface VehicleToggleRowProps {
  vehicle: VehicleSummary;
  onToggle: () => void;
}

export function VehicleToggleRow({ vehicle, onToggle }: VehicleToggleRowProps) {
  const [toggling, setToggling] = useState(false);

  async function toggle() {
    setToggling(true);
    try {
      await postJson(`/api/vehicles/${vehicle.id}/enabled`, { enabled: !vehicle.enabled }, "PATCH");
      onToggle();
    } catch {
      // silent — parent refresh will restore accurate state
    } finally {
      setToggling(false);
    }
  }

  return (
    <li className="vehicleRow">
      <div>
        <strong>{vehicle.name}</strong>
        <span>
          {vehicle.model ?? "Unknown model"}
          {vehicle.vinSuffix ? ` · ····${vehicle.vinSuffix}` : ""}
        </span>
        <span className="softwareVersion">{vehicle.softwareVersion ?? "Unknown software"}</span>
      </div>
      <button
        className={`toggleButton ${vehicle.enabled ? "enabled" : "disabled"}`}
        disabled={toggling}
        onClick={() => void toggle()}
      >
        {vehicle.enabled ? "Enabled" : "Disabled"}
      </button>
    </li>
  );
}
