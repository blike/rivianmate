import { useState } from "react";
import { postJson } from "../api/client.js";
import type { RivianVehicleDiscoveryResult } from "../types/index.js";

interface RivianConnectedPanelProps {
  email: string | null;
  onDiscover: () => void;
}

export function RivianConnectedPanel({ email, onDiscover }: RivianConnectedPanelProps) {
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function discoverVehicles() {
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const result = await postJson<RivianVehicleDiscoveryResult>(
        "/api/rivian/vehicles/discover",
        {}
      );
      setMessage(
        `Discovered ${result.vehicles.length} vehicle${result.vehicles.length === 1 ? "" : "s"}.`
      );
      onDiscover();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to discover vehicles.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="credentialBand">
      <div>
        <p className="eyebrow">Rivian Account</p>
        <h2>Rivian account connected</h2>
        <p>{email ? `Signed in as ${email}.` : "Credentials are stored encrypted locally."}</p>
      </div>
      <div className="buttonRow">
        <button
          className="primaryButton"
          disabled={submitting}
          onClick={() => void discoverVehicles()}
          type="button"
        >
          {submitting ? "Discovering..." : "Discover Vehicles"}
        </button>
      </div>
      {message && <div className="notice">{message}</div>}
      {error && <div className="notice error">{error}</div>}
    </section>
  );
}
