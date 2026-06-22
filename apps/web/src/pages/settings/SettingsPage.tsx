import { Car, Gauge, PlugZap, Settings, User } from "lucide-react";
import { Panel } from "../../components/ui/Panel.js";
import { RivianConnectedPanel } from "../../screens/RivianConnectedPanel.js";
import { RivianCredentialPanel } from "../../screens/RivianCredentialPanel.js";
import type { RivianCredentialStatus, UnitPrefs, VehicleSummary } from "../../types/index.js";
import { ChangePasswordForm } from "./ChangePasswordForm.js";
import { ChangeUsernameForm } from "./ChangeUsernameForm.js";
import { DisconnectRivianButton } from "./DisconnectRivianButton.js";
import { VehicleToggleRow } from "./VehicleToggleRow.js";

interface SettingsPageProps {
  vehicles: VehicleSummary[];
  rivianCredentials: RivianCredentialStatus | null;
  username: string;
  unitPrefs: UnitPrefs;
  onUnitPrefsChange: (patch: Partial<UnitPrefs>) => void;
  onRefresh: () => void;
}

export function SettingsPage({
  vehicles,
  rivianCredentials,
  username,
  unitPrefs,
  onUnitPrefsChange,
  onRefresh,
}: SettingsPageProps) {
  return (
    <div className="pageContent">
      <Panel title="Rivian Account" icon={<PlugZap size={18} aria-hidden />}>
        {rivianCredentials?.configured ? (
          <div className="settingsPanelContent">
            <RivianConnectedPanel
              email={rivianCredentials.email}
              embedded
              onDiscover={onRefresh}
            />
            <div className="settingsRow">
              <div>
                <strong>Disconnect</strong>
                <span>Remove stored Rivian credentials from this instance.</span>
              </div>
              <DisconnectRivianButton onDisconnect={onRefresh} />
            </div>
          </div>
        ) : (
          <RivianCredentialPanel embedded onComplete={onRefresh} />
        )}
      </Panel>

      <Panel title="Vehicles" icon={<Car size={18} aria-hidden />}>
        {vehicles.length === 0 ? (
          <p className="emptyState">No vehicles discovered yet.</p>
        ) : (
          <ul className="vehicleList">
            {vehicles.map((v) => (
              <VehicleToggleRow key={v.id} vehicle={v} onToggle={onRefresh} />
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Units" icon={<Gauge size={18} aria-hidden />}>
        <div className="settingsRow">
          <div>
            <strong>Distance</strong>
            <span>Miles or kilometers</span>
          </div>
          <div className="toggleGroup">
            <button
              className={`toggleButton ${unitPrefs.distance === "mi" ? "enabled" : "disabled"}`}
              onClick={() => onUnitPrefsChange({ distance: "mi" })}
            >
              mi
            </button>
            <button
              className={`toggleButton ${unitPrefs.distance === "km" ? "enabled" : "disabled"}`}
              onClick={() => onUnitPrefsChange({ distance: "km" })}
            >
              km
            </button>
          </div>
        </div>
        <div className="settingsRow">
          <div>
            <strong>Temperature</strong>
            <span>Fahrenheit or Celsius</span>
          </div>
          <div className="toggleGroup">
            <button
              className={`toggleButton ${unitPrefs.temperature === "f" ? "enabled" : "disabled"}`}
              onClick={() => onUnitPrefsChange({ temperature: "f" })}
            >
              °F
            </button>
            <button
              className={`toggleButton ${unitPrefs.temperature === "c" ? "enabled" : "disabled"}`}
              onClick={() => onUnitPrefsChange({ temperature: "c" })}
            >
              °C
            </button>
          </div>
        </div>
      </Panel>

      <Panel title="Local Account" icon={<User size={18} aria-hidden />}>
        <ChangeUsernameForm currentUsername={username} onComplete={onRefresh} />
      </Panel>

      <Panel title="Change Password" icon={<Settings size={18} aria-hidden />}>
        <ChangePasswordForm />
      </Panel>
    </div>
  );
}
