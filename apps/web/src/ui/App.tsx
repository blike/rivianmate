import {
  Activity,
  BatteryCharging,
  Car,
  Database,
  Heart,
  Map,
  PlugZap,
  Route,
  Settings,
} from "lucide-react";
import { useCallback, useState } from "react";
import "../styles.css";
import { logout } from "../api/client.js";
import { StatusPill } from "../components/ui/StatusPill.js";
import { useAppData } from "../hooks/useAppData.js";
import { useUnitPrefs } from "../hooks/useUnitPrefs.js";
import { BatteryPage } from "../pages/BatteryPage.js";
import { ChargingPage } from "../pages/ChargingPage.js";
import { DataQualityPage } from "../pages/DataQualityPage.js";
import { DrivesPage } from "../pages/DrivesPage.js";
import { HealthPage } from "../pages/HealthPage.js";
import { LocationsPage } from "../pages/LocationsPage.js";
import { OverviewPage } from "../pages/OverviewPage.js";
import { SettingsPage } from "../pages/settings/SettingsPage.js";
import { BootScreen } from "../screens/BootScreen.js";
import { LoginScreen } from "../screens/LoginScreen.js";
import { SetupScreen } from "../screens/SetupScreen.js";
import type { Page } from "../types/index.js";

export function App() {
  const [page, setPage] = useState<Page>("overview");
  const { unitPrefs, update: updateUnitPrefs } = useUnitPrefs();
  const data = useAppData();

  const refresh = useCallback(() => {
    window.location.reload();
  }, []);

  // ── Boot / loading ────────────────────────────────────────────────────────
  if (data.loading) return <BootScreen />;
  if (data.error) return <BootScreen error={data.error} />;

  // ── First-run setup ───────────────────────────────────────────────────────
  if (!data.setup?.adminConfigured) return <SetupScreen onComplete={refresh} />;

  // ── Login ─────────────────────────────────────────────────────────────────
  if (!data.auth?.authenticated) return <LoginScreen onComplete={refresh} />;

  // ── Main app ──────────────────────────────────────────────────────────────
  const primaryVehicleId = data.vehicles.find((v) => v.enabled)?.id ?? null;

  return (
    <div className="appShell">
      {/* ── Sidebar ──────────────────────────────────────────────────── */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark">
            <Car size={18} aria-hidden />
          </div>
          <div>
            <strong>RivianMate</strong>
            <StatusPill status={data.overview?.collectorStatus ?? "offline"} />
          </div>
        </div>

        <nav className="sideNav" aria-label="Main navigation">
          <NavSection label="Vehicle">
            <NavItem
              current={page}
              icon={<Car size={16} aria-hidden />}
              id="overview"
              label="Overview"
              onClick={setPage}
            />
            <NavItem
              current={page}
              icon={<Route size={16} aria-hidden />}
              id="drives"
              label="Drives"
              onClick={setPage}
            />
            <NavItem
              current={page}
              icon={<PlugZap size={16} aria-hidden />}
              id="charging"
              label="Charging"
              onClick={setPage}
            />
            <NavItem
              current={page}
              icon={<BatteryCharging size={16} aria-hidden />}
              id="battery"
              label="Battery"
              onClick={setPage}
            />
          </NavSection>

          <NavSection label="Insights">
            <NavItem
              current={page}
              icon={<Map size={16} aria-hidden />}
              id="locations"
              label="Locations"
              onClick={setPage}
            />
            <NavItem
              current={page}
              icon={<Heart size={16} aria-hidden />}
              id="health"
              label="Health"
              onClick={setPage}
            />
            <NavItem
              current={page}
              icon={<Activity size={16} aria-hidden />}
              id="data-quality"
              label="Data Quality"
              onClick={setPage}
            />
          </NavSection>

          <NavSection label="System">
            <NavItem
              current={page}
              icon={<Settings size={16} aria-hidden />}
              id="settings"
              label="Settings"
              onClick={setPage}
            />
          </NavSection>
        </nav>

        <div className="sidebarFooter">
          <span className="sidebarUser">{data.auth.username}</span>
          <button className="logoutButton" onClick={() => void logout().then(refresh)}>
            Log out
          </button>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────────────── */}
      <main className="mainContent">
        <header className="pageHeader">
          <h1>{pageTitle(page)}</h1>
        </header>

        {page === "overview" && (
          <OverviewPage data={data} unitPrefs={unitPrefs} />
        )}
        {page === "drives" && <DrivesPage drives={data.drives} unitPrefs={unitPrefs} />}
        {page === "charging" && <ChargingPage sessions={data.charging} />}
        {page === "battery" && <BatteryPage history={data.history} unitPrefs={unitPrefs} />}
        {page === "locations" && <LocationsPage overview={data.overview} />}
        {page === "health" && <HealthPage vehicleId={primaryVehicleId} />}
        {page === "data-quality" && <DataQualityPage summary={data.dataQuality} />}
        {page === "settings" && (
          <SettingsPage
            rivianCredentials={data.rivianCredentials}
            unitPrefs={unitPrefs}
            username={data.auth.username ?? "admin"}
            vehicles={data.vehicles}
            onRefresh={refresh}
            onUnitPrefsChange={updateUnitPrefs}
          />
        )}
      </main>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

interface NavSectionProps {
  label: string;
  children: React.ReactNode;
}

function NavSection({ label, children }: NavSectionProps) {
  return (
    <div className="navSection">
      <span className="navSectionLabel">{label}</span>
      {children}
    </div>
  );
}

interface NavItemProps {
  id: Page;
  label: string;
  icon: React.ReactNode;
  current: Page;
  onClick: (page: Page) => void;
}

function NavItem({ id, label, icon, current, onClick }: NavItemProps) {
  const isActive = current === id;

  return (
    <button
      aria-current={isActive ? "page" : undefined}
      className={`navItem ${isActive ? "active" : ""}`}
      onClick={() => onClick(id)}
    >
      <span className="navItemIcon">{icon}</span>
      <span className="navItemLabel">{label}</span>
    </button>
  );
}

function pageTitle(page: Page): string {
  switch (page) {
    case "overview":
      return "Overview";
    case "drives":
      return "Drives";
    case "charging":
      return "Charging";
    case "battery":
      return "Battery";
    case "locations":
      return "Locations";
    case "health":
      return "Vehicle Health";
    case "data-quality":
      return "Data Quality";
    case "settings":
      return "Settings";
  }
}
