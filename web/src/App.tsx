import { useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useLiveState, useStatus, useUnitPreferences, useVehicles } from "./api/hooks.js";
import { AppHeader } from "./components/AppHeader.js";
import { Charging } from "./pages/Charging.js";
import { Dashboard } from "./pages/Dashboard.js";
import { Drives } from "./pages/Drives.js";
import { Health } from "./pages/Health.js";
import { History } from "./pages/History.js";
import { Login } from "./pages/Login.js";
import { RivianConnect } from "./pages/RivianConnect.js";
import { Settings } from "./pages/Settings.js";
import { Setup } from "./pages/Setup.js";
import { Stats } from "./pages/Stats.js";

export default function App() {
  const { data: status, isLoading, refetch } = useStatus();

  if (isLoading || !status) {
    return (
      <div className="delayed-fade-in flex h-full items-center justify-center text-[var(--text-muted)]">
        Loading…
      </div>
    );
  }

  if (status.needsSetup) return <Setup onDone={() => refetch()} />;
  if (!status.authed) return <Login onDone={() => refetch()} />;
  if (!status.rivianConnected) {
    return (
      <RivianConnect
        mockMode={status.mockMode}
        reauth={status.rivianAuthState === "unauthenticated"}
        email={status.rivianEmail}
        onDone={() => refetch()}
      />
    );
  }
  return <Shell />;
}

function Shell() {
  const { data: vehicles, isPending: vehiclesPending } = useVehicles();
  // Wait for units too, so values don't re-render from the default units.
  const { isPending: unitsPending } = useUnitPreferences();
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const vehicleId = selectedId ?? vehicles?.[0]?.id;
  const vehicle = vehicles?.find((v) => v.id === vehicleId);
  useLiveState(vehicleId);

  return (
    <div className="mx-auto flex min-h-full max-w-6xl flex-col px-4">
      <AppHeader vehicles={vehicles} vehicleId={vehicleId} onSelectVehicle={setSelectedId} />
      <main className="flex-1 pb-10">
        {vehiclesPending || unitsPending ? null : !vehicleId ? (
          <p className="text-[var(--text-muted)]">
            {vehicles ? "No vehicles found." : "Couldn't load vehicles."}
          </p>
        ) : (
          <Routes>
            <Route path="/" element={<Dashboard vehicleId={vehicleId} vehicle={vehicle} />} />
            <Route path="/history" element={<History vehicleId={vehicleId} />} />
            <Route path="/drives" element={<Drives vehicleId={vehicleId} />} />
            <Route path="/charging" element={<Charging vehicleId={vehicleId} />} />
            <Route path="/health" element={<Health vehicleId={vehicleId} />} />
            <Route path="/stats" element={<Stats vehicleId={vehicleId} />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </main>
    </div>
  );
}
