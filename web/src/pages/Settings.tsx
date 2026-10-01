import { useState } from "react";
import { ApiError, api } from "../api/client.js";
import {
  useRivianDiagnostics,
  useRivianDisconnect,
  useSetUnits,
  useStatus,
  useUnits,
  useVehicles,
} from "../api/hooks.js";
import { Panel, Row } from "../components/panels.js";
import { TextField } from "../components/AuthCard.js";

export function Settings() {
  const { data: status, refetch } = useStatus();
  const disconnect = useRivianDisconnect();
  const { data: diagnostics } = useRivianDiagnostics();
  const { data: vehicles } = useVehicles();
  const { units } = useUnits();
  const setUnits = useSetUnits();

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
    <div className="grid max-w-2xl grid-cols-1 gap-4">
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

      {diagnostics && (
        <Panel title="Rivian API usage (last 24h)">
          <dl className="space-y-1 text-sm">
            <Row
              label="Live stream"
              value={
                diagnostics.monitor.streamConnected
                  ? "Connected"
                  : diagnostics.monitor.fallbackPolling
                    ? "Down (slow polling)"
                    : "Down"
              }
            />
            <Row
              label="Requests"
              value={String(diagnostics.traffic.last24h.httpRequests)}
            />
            <Row
              label="Stream connects / reconnects"
              value={`${diagnostics.traffic.last24h.wsConnects} / ${diagnostics.traffic.last24h.wsReconnects}`}
            />
            <Row
              label="Session refreshes"
              value={String(diagnostics.traffic.last24h.sessionRefreshes)}
            />
            <Row
              label="Rate limited"
              value={String(diagnostics.traffic.last24h.rateLimited)}
            />
            {diagnostics.traffic.cooldownUntil && (
              <Row
                label="Paused until"
                value={new Date(diagnostics.traffic.cooldownUntil).toLocaleTimeString()}
              />
            )}
          </dl>
          {Object.keys(diagnostics.traffic.requestsByOperation24h).length > 0 && (
            <p className="mt-3 text-xs text-[var(--text-secondary)]">
              {Object.entries(diagnostics.traffic.requestsByOperation24h)
                .sort((a, b) => b[1] - a[1])
                .map(([op, n]) => `${op} ${n}`)
                .join(" · ")}
            </p>
          )}
        </Panel>
      )}

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

      <Panel title="App password">
        <div className="space-y-3">
          <TextField
            label="Current password"
            type="password"
            value={current}
            onChange={setCurrent}
          />
          <TextField
            label="New password (min 8 characters)"
            type="password"
            value={next}
            onChange={setNext}
          />
          {message && (
            <p className="text-sm text-[var(--text-secondary)]">{message}</p>
          )}
          <button
            className="rounded-md bg-[var(--series-1)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            disabled={next.length < 8 || !current}
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
