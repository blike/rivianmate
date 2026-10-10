import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError, api } from "../api/client.js";
import {
  useRivianDiagnostics,
  useRivianDisconnect,
  useSetUnits,
  useStatus,
  useUnits,
  useVehicles,
  useVersion,
} from "../api/hooks.js";
import { Skeleton } from "../components/loading.js";
import { HomeChargingPanel } from "../components/HomeChargingPanel.js";
import { NotificationsPanel } from "../components/NotificationsPanel.js";
import { passwordProblem } from "@server/password-policy.js";
import { TextField } from "../components/AuthCard.js";
import { REPO_URL, shortCommit, versionLabel } from "../lib/version.js";
import { ApiConnectionsPanel } from "../components/ApiConnectionsPanel.js";
import { PasswordHint } from "../components/PasswordHint.js";
import {
  SegmentedControl,
  SettingRow,
  SettingsGroup,
  SettingsHero,
  dangerButton,
  secondaryButton,
} from "../components/settings.js";

const sections = [
  { id: "general", label: "General", description: "Your vehicle, display units and Rivian account.", icon: <CarIcon /> },
  { id: "charging", label: "Charging", description: "How home charging is priced and recognized.", icon: <BoltIcon /> },
  { id: "notifications", label: "Notifications", description: "Alerts for doors, locks, software, charging and tires.", icon: <BellIcon /> },
  { id: "api", label: "API & Feeds", description: "How data is arriving from Rivian.", icon: <PulseIcon /> },
  { id: "security", label: "Security", description: "Your app password and this browser’s session.", icon: <LockIcon /> },
  { id: "about", label: "About", description: "Version, build and project links.", icon: <InfoIcon /> },
];

export function Settings() {
  const [params] = useSearchParams();
  const section = sections.find((item) => item.id === params.get("section")) ?? sections[0]!;
  const { data: status } = useStatus();
  const { data: diagnostics, isPending: diagnosticsPending, isError: diagnosticsError } = useRivianDiagnostics(section.id === "api");
  const { data: vehicles } = useVehicles();
  // On phones the nav is a scrolling strip; keep the open section in view.
  const activeLink = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    activeLink.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [section.id]);

  return (
    <div className="grid items-start gap-6 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-10">
      <nav
        aria-label="Settings"
        className="-mx-4 flex gap-1 overflow-x-auto px-4 md:sticky md:top-4 md:mx-0 md:flex-col md:overflow-visible md:px-0"
      >
        {sections.map((item) => {
          const nextParams = new URLSearchParams(params);
          nextParams.set("section", item.id);
          const active = section.id === item.id;
          return (
            <Link
              key={item.id}
              ref={active ? activeLink : undefined}
              to={{ search: `?${nextParams}` }}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-[var(--surface-2)] font-medium text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"
              }`}
            >
              <span className={active ? "text-[var(--accent)]" : "text-[var(--text-muted)]"}>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <section aria-label={section.label} className="min-w-0 max-w-3xl space-y-6">
        <header>
          <h2 className="text-xl font-semibold tracking-tight">{section.label}</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">{section.description}</p>
        </header>
        {section.id === "general" && (
          <General
            parallaxModes={diagnostics?.monitor.parallaxModes}
            email={status?.rivianEmail ?? null}
            connected={status?.rivianConnected ?? false}
            mockMode={status?.mockMode ?? false}
          />
        )}
        {section.id === "charging" && <HomeChargingPanel vehicleId={vehicles?.[0]?.id} />}
        {section.id === "notifications" && <NotificationsPanel />}
        {section.id === "api" && (
          <ApiConnectionsPanel
            diagnostics={diagnostics}
            loading={diagnosticsPending}
            error={diagnosticsError}
            vehicles={vehicles ?? []}
            mockMode={status?.mockMode ?? false}
          />
        )}
        {section.id === "security" && <Security />}
        {section.id === "about" && <About />}
      </section>
    </div>
  );
}

function General(props: {
  parallaxModes: Record<string, "classic" | "parallax"> | undefined;
  email: string | null;
  connected: boolean;
  mockMode: boolean;
}) {
  const { data: vehicles, isPending } = useVehicles();
  const { refetch } = useStatus();
  const disconnect = useRivianDisconnect();
  const u = useUnits();
  const { units } = u;
  const setUnits = useSetUnits();

  return (
    <>
      <SettingsGroup title={vehicles && vehicles.length > 1 ? "Vehicles" : "Vehicle"}>
        {isPending ? (
          <SettingRow label={<Skeleton className="w-[8em]" />} description={<Skeleton className="w-[5em]" />} />
        ) : !vehicles?.length ? (
          <SettingRow label="No vehicles yet" description="Vehicles on your Rivian account appear here once connected." />
        ) : (
          vehicles.map((v) => {
            const mode = props.parallaxModes?.[v.id];
            return (
              <SettingRow
                key={v.id}
                label={v.name ?? v.model ?? "Vehicle"}
                description={[v.modelYear, v.model, mode && (mode === "parallax" ? "Parallax data" : "Classic data")]
                  .filter(Boolean)
                  .join(" · ")}
              >
                <span className="select-all font-mono text-xs tracking-wide text-[var(--text-secondary)]">{v.vin}</span>
                <CopyButton text={v.vin} label="Copy VIN" />
              </SettingRow>
            );
          })
        )}
      </SettingsGroup>

      <SettingsGroup title="Units">
        <SettingRow
          label="Measurement"
          description={`Distance, speed, tire pressure and elevation: ${u.distanceUnit}, ${u.speedUnit}, ${u.pressureUnit}, ${u.elevationUnit}`}
        >
          <SegmentedControl
            label="Measurement"
            value={units.distance}
            options={[
              { value: "mi", label: "Imperial" },
              { value: "km", label: "Metric" },
            ]}
            onChange={(distance) => setUnits.mutate({ ...units, distance })}
          />
        </SettingRow>
        <SettingRow label="Temperature" description={`Cabin ${u.formatTemperature(21)} · Outside ${u.formatTemperature(4)}`}>
          <SegmentedControl
            label="Temperature"
            value={units.temperature}
            options={[
              { value: "F", label: "°F" },
              { value: "C", label: "°C" },
            ]}
            onChange={(temperature) => setUnits.mutate({ ...units, temperature })}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Rivian account">
        <SettingRow
          label={props.email ?? "—"}
          description={
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: props.connected ? "var(--status-good)" : "var(--text-muted)" }}
              />
              {props.connected ? "Connected" : "Disconnected"}
              {props.mockMode && " · Simulated vehicle"}
            </span>
          }
        />
        <SettingRow label="Disconnect" description="Stops tracking and forgets your Rivian sign-in. Your recorded history stays.">
          <button
            className={dangerButton}
            onClick={async () => {
              if (!confirm("Disconnect Rivian account and stop tracking?")) return;
              await disconnect.mutateAsync();
              refetch();
            }}
          >
            Disconnect
          </button>
        </SettingRow>
      </SettingsGroup>
    </>
  );
}

function Security() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const changePassword = async () => {
    setMessage(null);
    try {
      await api.changePassword(current, next);
      setCurrent("");
      setNext("");
      setMessage({ ok: true, text: "Password updated" });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : "Failed to update" });
    }
  };

  const logout = async () => {
    await api.logout();
    window.location.reload();
  };

  return (
    <>
      <SettingsGroup title="App password">
        <form
          className="max-w-md space-y-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void changePassword();
          }}
        >
          <TextField label="Current password" type="password" value={current} onChange={setCurrent} autoComplete="current-password" />
          <TextField
            label="New password"
            type="password"
            value={next}
            onChange={setNext}
            autoComplete="new-password"
            hint={<PasswordHint password={next} />}
          />
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button type="submit" className="btn-primary" disabled={!current || passwordProblem(next) !== null}>
              Change password
            </button>
            {message && (
              <p
                role={message.ok ? "status" : "alert"}
                className="text-sm"
                style={{ color: message.ok ? "var(--status-good)" : "var(--status-critical)" }}
              >
                {message.text}
              </p>
            )}
          </div>
        </form>
      </SettingsGroup>

      <SettingsGroup title="Session">
        <SettingRow label="Sign out" description="Signs this browser out. Tracking keeps running.">
          <button className={secondaryButton} onClick={logout}>
            Sign out
          </button>
        </SettingRow>
      </SettingsGroup>
    </>
  );
}

function About() {
  const { data: info, isPending } = useVersion();
  const commit = shortCommit(info?.commit);

  return (
    <>
      <SettingsHero
        tone="accent"
        eyebrow="RivianMate"
        headline={isPending ? <Skeleton className="w-[4em]" /> : versionLabel(info)}
        detail={
          isPending ? (
            <Skeleton className="w-[10em]" />
          ) : commit ? (
            <>
              Built from{" "}
              <a
                href={`${REPO_URL}/commit/${info!.commit}`}
                target="_blank"
                rel="noreferrer noopener"
                className="font-mono text-xs text-[var(--text-primary)] underline-offset-4 hover:underline"
              >
                {commit}
              </a>
            </>
          ) : (
            "Development build"
          )
        }
      />
      <SettingsGroup>
        <ExternalRow href={`${REPO_URL}/blob/main/CHANGELOG.md`} label="Changelog" description="What changed in each release" />
        <ExternalRow href={REPO_URL} label="Source code" description="RivianMate on GitHub" />
        <ExternalRow href={`${REPO_URL}/issues`} label="Report an issue" description="Bugs and feature requests" />
      </SettingsGroup>
    </>
  );
}

function ExternalRow(props: { href: string; label: string; description: string }) {
  return (
    <a
      href={props.href}
      target="_blank"
      rel="noreferrer noopener"
      className="flex items-center justify-between gap-4 px-4 py-3.5 transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-[var(--surface-2)]"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium">{props.label}</span>
        <span className="block text-xs text-[var(--text-muted)]">{props.description}</span>
      </span>
      <svg viewBox="0 0 12 12" className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
        <path d="M4.5 2.5h5v5M9.5 2.5l-7 7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </a>
  );
}

function CopyButton(props: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={secondaryButton}
      aria-label={props.label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(props.text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard unavailable (e.g. plain http); the VIN is still selectable.
        }
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function NavIcon(props: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {props.children}
    </svg>
  );
}

function CarIcon() {
  return (
    <NavIcon>
      <path d="M2.5 10V8.2l1.3-3.1A1.5 1.5 0 0 1 5.2 4h5.6a1.5 1.5 0 0 1 1.4 1.1l1.3 3.1V10a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1ZM2.5 8.5h11M4.5 11v1.5M11.5 11v1.5" />
    </NavIcon>
  );
}

function BoltIcon() {
  return (
    <NavIcon>
      <path d="M9 1.5 3.5 9h4l-.5 5.5L12.5 7h-4L9 1.5Z" />
    </NavIcon>
  );
}

function BellIcon() {
  return (
    <NavIcon>
      <path d="M4 6.5a4 4 0 1 1 8 0c0 3 1.5 4.5 1.5 4.5h-11S4 9.5 4 6.5ZM6.5 13.5a1.5 1.5 0 0 0 3 0" />
    </NavIcon>
  );
}

function PulseIcon() {
  return (
    <NavIcon>
      <path d="M1.5 8h3l1.5-4 3 8 1.5-4h4" />
    </NavIcon>
  );
}

function LockIcon() {
  return (
    <NavIcon>
      <path d="M4 7.5V5.5a4 4 0 0 1 8 0v2M3.5 7.5h9v6h-9z" />
    </NavIcon>
  );
}

function InfoIcon() {
  return (
    <NavIcon>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.5v3.5M8 5h.01" />
    </NavIcon>
  );
}
