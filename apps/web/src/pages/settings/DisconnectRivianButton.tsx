import { useState } from "react";
import { postJson } from "../../api/client.js";

interface DisconnectRivianButtonProps {
  onDisconnect: () => void;
}

export function DisconnectRivianButton({ onDisconnect }: DisconnectRivianButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function disconnect() {
    setSubmitting(true);
    try {
      await postJson("/api/rivian/credentials", {}, "DELETE");
      onDisconnect();
    } catch {
      setSubmitting(false);
    }
  }

  if (confirming) {
    return (
      <div className="buttonRow">
        <button
          className="dangerButton"
          disabled={submitting}
          onClick={() => void disconnect()}
        >
          {submitting ? "Disconnecting..." : "Confirm disconnect"}
        </button>
        <button onClick={() => setConfirming(false)}>Cancel</button>
      </div>
    );
  }

  return (
    <button className="dangerButton" onClick={() => setConfirming(true)}>
      Disconnect Rivian
    </button>
  );
}
