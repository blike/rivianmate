import { useState } from "react";
import { ApiError, api } from "../api/client.js";
import { useRivianDisconnect, useStatus } from "../api/hooks.js";
import { Panel, Row } from "../components/panels.js";
import { TextField } from "../components/AuthCard.js";

export function Settings() {
  const { data: status, refetch } = useStatus();
  const disconnect = useRivianDisconnect();

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
