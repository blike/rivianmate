import { useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useLiveState, useStatus, useUnitPreferences, useVehicles } from './api/hooks';
import { AppHeader } from './components/AppHeader';
import { ChargingPage } from './features/charging/ChargingPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { DrivesPage } from './features/drives/DrivesPage';
import { HealthPage } from './features/health/HealthPage';
import { HistoryPage } from './features/history/HistoryPage';
import { LoginPage } from './features/auth/LoginPage';
import { RivianConnectPage } from './features/auth/RivianConnectPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { SetupPage } from './features/auth/SetupPage';

export default function App() {
  const { data: status, isLoading, refetch } = useStatus();

  if (isLoading || !status) {
    return (
      <div className="delayed-fade-in flex h-full items-center justify-center text-(--text-muted)">
        Loading…
      </div>
    );
  }

  if (status.needsSetup) return <SetupPage onDone={() => refetch()} />;
  if (!status.authed) return <LoginPage onDone={() => refetch()} />;
  // TeslaMate alone is enough to show something; Rivian can be connected later.
  if (!status.rivianConnected && !status.teslamateConfigured) {
    return (
      <RivianConnectPage
        mockMode={status.mockMode}
        reauth={status.rivianAuthState === 'unauthenticated'}
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
          <p className="text-(--text-muted)">
            {vehicles ? 'No vehicles found.' : "Couldn't load vehicles."}
          </p>
        ) : (
          <Routes>
            <Route path="/" element={<DashboardPage vehicleId={vehicleId} vehicle={vehicle} />} />
            <Route path="/history" element={<HistoryPage vehicleId={vehicleId} />} />
            <Route path="/drives" element={<DrivesPage vehicleId={vehicleId} />} />
            <Route path="/charging" element={<ChargingPage vehicleId={vehicleId} />} />
            <Route path="/health" element={<HealthPage vehicleId={vehicleId} />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </main>
    </div>
  );
}
