import {
  Activity,
  BatteryCharging,
  Car,
  Database,
  Heart,
  Map,
  Menu,
  Mountain,
  PlugZap,
  Route,
  Settings,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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

const PAGES = new Set<Page>(["overview", "drives", "charging", "battery", "locations", "health", "data-quality", "settings"]);

function parsePage(): Page {
  const hash = window.location.hash.slice(1);
  return PAGES.has(hash as Page) ? (hash as Page) : "overview";
}

export function App() {
  const [page, setPage] = useState<Page>(parsePage);
  const [navOpen, setNavOpen] = useState(false);
  const { unitPrefs, update: updateUnitPrefs } = useUnitPrefs();
  const data = useAppData();

  const refresh = useCallback(() => {
    window.location.reload();
  }, []);

  const navigate = useCallback((p: Page) => {
    window.location.hash = p;
    setPage(p);
    setNavOpen(false);
  }, []);

  useEffect(() => {
    const onHashChange = () => setPage(parsePage());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    document.body.style.overflow = navOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [navOpen]);

  // Only show the boot screen after a short delay so fast loads (e.g. a
  // page refresh with an active session) never produce a visible flash.
  const [showLoader, setShowLoader] = useState(false);
  useEffect(() => {
    if (!data.loading) { setShowLoader(false); return; }
    const t = setTimeout(() => setShowLoader(true), 300);
    return () => clearTimeout(t);
  }, [data.loading]);

  // ── Boot / loading ────────────────────────────────────────────────────────
  if (data.loading) return showLoader ? <BootScreen /> : null;
  if (data.error) return <BootScreen error={data.error} />;

  // ── First-run setup ───────────────────────────────────────────────────────
  if (!data.setup?.adminConfigured) return <SetupScreen onComplete={refresh} />;

  // ── Login ─────────────────────────────────────────────────────────────────
  if (!data.auth?.authenticated) return <LoginScreen onComplete={refresh} />;

  // ── Main app ──────────────────────────────────────────────────────────────
  const primaryVehicleId = data.vehicles.find((v) => v.enabled)?.id ?? null;

  return (
    <div className="appShell">
      {/* ── Mobile header ────────────────────────────────────────────── */}
      <div className="mobileHeader">
        <div className="mobileBrand">
          <div className="brandMark"><Mountain size={16} aria-hidden /></div>
          <strong>RivianMate</strong>
        </div>
        <button
          className="hamburger"
          aria-label={navOpen ? "Close navigation" : "Open navigation"}
          onClick={() => setNavOpen((v) => !v)}
        >
          {navOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* ── Nav backdrop ─────────────────────────────────────────────── */}
      <div
        className={`backdrop${navOpen ? " open" : ""}`}
        aria-hidden="true"
        onClick={() => setNavOpen(false)}
      />

      {/* ── Sidebar ──────────────────────────────────────────────────── */}
      <aside className={`sidebar${navOpen ? " open" : ""}`}>
        <div className="brand">
          <div className="brandMark">
            <Mountain size={18} aria-hidden />
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
              onClick={navigate}
            />
            <NavItem
              current={page}
              icon={<Route size={16} aria-hidden />}
              id="drives"
              label="Drives"
              onClick={navigate}
            />
            <NavItem
              current={page}
              icon={<PlugZap size={16} aria-hidden />}
              id="charging"
              label="Charging"
              onClick={navigate}
            />
            <NavItem
              current={page}
              icon={<BatteryCharging size={16} aria-hidden />}
              id="battery"
              label="Battery"
              onClick={navigate}
            />
          </NavSection>

          <NavSection label="Insights">
            <NavItem
              current={page}
              icon={<Map size={16} aria-hidden />}
              id="locations"
              label="Locations"
              onClick={navigate}
            />
            <NavItem
              current={page}
              icon={<Heart size={16} aria-hidden />}
              id="health"
              label="Health"
              onClick={navigate}
            />
            <NavItem
              current={page}
              icon={<Activity size={16} aria-hidden />}
              id="data-quality"
              label="Data Quality"
              onClick={navigate}
            />
          </NavSection>

          <NavSection label="System">
            <NavItem
              current={page}
              icon={<Settings size={16} aria-hidden />}
              id="settings"
              label="Settings"
              onClick={navigate}
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
