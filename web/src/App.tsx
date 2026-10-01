import { useState } from "react";
import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { useLiveState, useStatus, useVehicles } from "./api/hooks.js";
import { Charging } from "./pages/Charging.js";
import { Dashboard } from "./pages/Dashboard.js";
import { Drives } from "./pages/Drives.js";
import { Health } from "./pages/Health.js";
import { History } from "./pages/History.js";
import { Login } from "./pages/Login.js";
import { RivianConnect } from "./pages/RivianConnect.js";
import { Settings } from "./pages/Settings.js";
import { Setup } from "./pages/Setup.js";

export default function App() {
  const { data: status, isLoading, refetch } = useStatus();

  if (isLoading || !status) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--text-muted)]">
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

const NAV = [
  { to: "/", label: "Dashboard" },
  { to: "/history", label: "History" },
  { to: "/drives", label: "Drives" },
  { to: "/charging", label: "Charging" },
  { to: "/health", label: "Health" },
  { to: "/settings", label: "Settings" },
];

function Shell() {
  const { data: vehicles } = useVehicles();
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const vehicleId = selectedId ?? vehicles?.[0]?.id;
  const vehicle = vehicles?.find((v) => v.id === vehicleId);
  useLiveState(vehicleId);

  return (
    <div className="mx-auto flex min-h-full max-w-6xl flex-col px-4">
      <header className="flex flex-wrap items-center gap-4 py-4">
        <h1 className="text-xl font-semibold tracking-tight">
          Rivian<span className="text-[var(--accent)]">Mate</span>
        </h1>
        <nav className="flex gap-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `rounded-md px-3 py-1.5 text-sm ${
                  isActive
                    ? "bg-[var(--surface-2)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        {vehicles && vehicles.length > 1 && (
          <select
            className="ml-auto rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-sm"
            value={vehicleId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name ?? v.model ?? v.vin}
              </option>
            ))}
          </select>
        )}
      </header>
      <main className="flex-1 pb-10">
        {!vehicleId ? (
          <p className="text-[var(--text-muted)]">No vehicles found.</p>
        ) : (
          <Routes>
            <Route path="/" element={<Dashboard vehicleId={vehicleId} vehicle={vehicle} />} />
            <Route path="/history" element={<History vehicleId={vehicleId} />} />
            <Route path="/drives" element={<Drives vehicleId={vehicleId} />} />
            <Route path="/charging" element={<Charging vehicleId={vehicleId} />} />
            <Route path="/health" element={<Health vehicleId={vehicleId} />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </main>
    </div>
  );
}
