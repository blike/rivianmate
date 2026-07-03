import { useState } from "react";
import { ApiError, api } from "../api/client.js";
import { AuthCard, TextField } from "../components/AuthCard.js";

export function Login(props: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      props.onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard
      title="Sign in"
      error={error}
      busy={busy}
      submitLabel="Sign in"
      onSubmit={submit}
    >
      <TextField
        label="App password"
        type="password"
        value={password}
        onChange={setPassword}
        autoFocus
      />
    </AuthCard>
  );
}
