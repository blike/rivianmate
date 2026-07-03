import { useState } from "react";
import { ApiError, api } from "../api/client.js";
import { AuthCard, TextField } from "../components/AuthCard.js";

export function Setup(props: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (password.length < 8) return setError("Use at least 8 characters");
    if (password !== confirm) return setError("Passwords do not match");
    setBusy(true);
    setError(null);
    try {
      await api.setup(password);
      props.onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Setup failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard
      title="Welcome"
      subtitle="Choose a password to protect this app. You'll connect your Rivian account next."
      error={error}
      busy={busy}
      submitLabel="Create password"
      onSubmit={submit}
    >
      <TextField
        label="App password"
        type="password"
        value={password}
        onChange={setPassword}
        autoFocus
      />
      <TextField
        label="Confirm password"
        type="password"
        value={confirm}
        onChange={setConfirm}
      />
    </AuthCard>
  );
}
