import { useState } from "react";
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
import { LoadingScope } from "../components/loading.js";
import { HomeChargingPanel } from "../components/HomeChargingPanel.js";
import { Panel, Row } from "../components/panels.js";
import { passwordProblem } from "@server/password-policy.js";
import { TextField } from "../components/AuthCard.js";
import { REPO_URL, shortCommit, versionLabel } from "../lib/version.js";
import { ApiConnectionsPanel } from "../components/ApiConnectionsPanel.js";
import { PasswordHint } from "../components/PasswordHint.js";

const sections = [
  { id: "general", label: "General", description: "Your Rivian account, vehicles, and display preferences." },
  { id: "charging", label: "Charging", description: "Home location and electricity costs." },
  { id: "api", label: "API & feeds", description: "Live data delivery and connection diagnostics." },
  { id: "security", label: "Security", description: "Manage your app password and session." },
  { id: "about", label: "About", description: "Version, build, and release notes." },
];

export function Settings() {
  const [params] = useSearchParams();
  const section = sections.find(item => item.id === params.get("section")) ?? sections[0]!;
  const { data: status, refetch } = useStatus();
  const disconnect = useRivianDisconnect();
  const { data: diagnostics, isPending: diagnosticsPending, isError: diagnosticsError } = useRivianDiagnostics(section.id === "api");
  const { data: vehicles } = useVehicles();
  const { units } = useUnits();
  const setUnits = useSetUnits();
  const { data: versionInfo, isPending: versionPending } = useVersion();
  const commit = shortCommit(versionInfo?.commit);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const changePassword = async () => {
    setMessage(null);
    try {
      await api.changePassword(current, next);
      setCurrent("");
      setNext("");
      setMessage("Password updated");
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Failed to update");
    }
  };

  const logout = async () => {
    await api.logout();
    window.location.reload();
  };

  return (
    <div className="grid items-start gap-6 md:grid-cols-[11rem_minmax(0,1fr)]">
      <nav aria-label="Settings" className="flex gap-1 overflow-x-auto rounded-lg border border-[var(--border)] p-1 md:sticky md:top-4 md:flex-col">
        {sections.map(item => {
          const nextParams = new URLSearchParams(params);
          nextParams.set("section", item.id);
          return <Link
            key={item.id}
            to={{ search: `?${nextParams}` }}
            aria-current={section.id === item.id ? "page" : undefined}
            className={`whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors ${section.id === item.id ? "bg-[var(--surface-2)] font-medium text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"}`}
          >{item.label}</Link>;
        })}
      </nav>
      <section aria-label={section.label} className="min-w-0 space-y-4">
        <header>
          <h2 className="text-lg font-semibold">{section.label}</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">{section.description}</p>
        </header>
        {section.id === "api" && <ApiConnectionsPanel diagnostics={diagnostics} loading={diagnosticsPending} error={diagnosticsError} vehicles={vehicles ?? []} mockMode={status?.mockMode ?? false} />}
        {section.id === "general" && <>
      <Panel title="Rivian account">
        <dl className="space-y-1 text-sm">
          <Row label="Account" value={status?.rivianEmail ?? "—"} />
          <Row
            label="Connection"
            value={status?.rivianConnected ? "Connected" : "Disconnected"}
          />
          {status?.mockMode && <Row label="Mode" value="Mock (simulated vehicle)" />}
        </dl>
        <button
          className="mt-4 rounded-md border border-[var(--status-critical)] px-3 py-1.5 text-sm text-[var(--status-critical)] hover:bg-[var(--status-critical)] hover:text-white"
          onClick={async () => {
            if (!confirm("Disconnect Rivian account and stop tracking?")) return;
            await disconnect.mutateAsync();
            refetch();
          }}
        >
          Disconnect Rivian account
        </button>
      </Panel>


      {vehicles && vehicles.length > 0 && (
        <Panel title={vehicles.length > 1 ? "Vehicles" : "Vehicle"}>
          <ul className="space-y-3 text-sm">
            {vehicles.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium">{v.name ?? v.model ?? "Vehicle"}</div>
                  <div className="text-xs text-[var(--text-muted)]">
                    {[v.modelYear, v.model].filter(Boolean).join(" ") || "—"}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {diagnostics && (
                    <span
                      className={
                        diagnostics.monitor.parallaxModes[v.id] === "parallax"
                          ? "rounded-full px-2 py-0.5 text-xs font-medium text-white"
                          : "rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--text-secondary)]"
                      }
                      style={
                        diagnostics.monitor.parallaxModes[v.id] === "parallax"
                          ? { background: "var(--series-3)" }
                          : undefined
                      }
                      title="Read-only: Rivian reports this per vehicle; it can't be changed here."
                    >
                      {diagnostics.monitor.parallaxModes[v.id] === "parallax" ? "w/ Parallax" : "Classic"}
                    </span>
                  )}
                  <span className="font-mono text-xs tracking-wide text-[var(--text-secondary)] select-all">
                    {v.vin}
                  </span>
                  <CopyButton text={v.vin} label="Copy VIN" />
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="Units">
        <div className="space-y-3 text-sm">
          <UnitToggle
            label="Distance & speed"
            value={units.distance}
            options={[
              { value: "mi", label: "Miles" },
              { value: "km", label: "Kilometers" },
            ]}
            onChange={(distance) => setUnits.mutate({ ...units, distance })}
          />
          <UnitToggle
            label="Temperature"
            value={units.temperature}
            options={[
              { value: "F", label: "°F" },
              { value: "C", label: "°C" },
            ]}
            onChange={(temperature) => setUnits.mutate({ ...units, temperature })}
          />
        </div>
      </Panel>

        </>}
      {section.id === "charging" && <HomeChargingPanel vehicleId={vehicles?.[0]?.id} />}
      {section.id === "security" && <>

      <Panel title="App password">
        <div className="space-y-3">
          <TextField
            label="Current password"
            type="password"
            value={current}
            onChange={setCurrent}
            autoComplete="current-password"
          />
          <TextField
            label="New password"
            type="password"
            value={next}
            onChange={setNext}
            autoComplete="new-password"
            hint={<PasswordHint password={next} />}
          />
          {message && (
            <p className="text-sm text-[var(--text-secondary)]">{message}</p>
          )}
          <button
            className="rounded-md bg-[var(--series-1)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            disabled={!current || passwordProblem(next) !== null}
            onClick={changePassword}
          >
            Change password
          </button>
        </div>
      </Panel>

      <Panel title="Session">
        <button
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          onClick={logout}
        >
          Sign out
        </button>
      </Panel>
      </>}
      {section.id === "about" && <>
      <Panel title="About">
        <LoadingScope loading={versionPending}>
          <dl className="space-y-1 text-sm">
            <Row label="Version" value={versionLabel(versionInfo)} />
            <Row
              label="Build"
              value={
                commit ? (
                  <a
                    href={`${REPO_URL}/commit/${versionInfo!.commit}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="font-mono text-xs text-[var(--series-1)] hover:underline"
                  >
                    {commit}
                  </a>
                ) : (
                  "Development"
                )
              }
            />
          </dl>
        </LoadingScope>
        <a
          href={`${REPO_URL}/blob/main/CHANGELOG.md`}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-3 inline-block text-xs text-[var(--series-1)] hover:underline"
        >
          Changelog ↗
        </a>
      </Panel>

      </>}
      </section>
    </div>
  );
}

function UnitToggle<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[var(--text-secondary)]">{props.label}</span>
      <div
        role="radiogroup"
        aria-label={props.label}
        className="flex rounded-md border border-[var(--border)] p-0.5"
      >
        {props.options.map((o) => (
          <button
            key={o.value}
            role="radio"
            aria-checked={o.value === props.value}
            className={`rounded px-3 py-1 ${
              o.value === props.value
                ? "bg-[var(--series-1)] text-white"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
            onClick={() => props.onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function CopyButton(props: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={props.label}
      className="rounded border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
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
