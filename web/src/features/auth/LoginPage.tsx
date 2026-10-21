import { useState } from 'react';
import { ApiError, api } from '../../api/client';
import { AuthCard, TextField } from '../../components/AuthCard';

/**
 * Signing in; on a first boot with APP_PASSWORD it's also the first step of
 * setup, in place of choosing a password.
 */
export function LoginPage(props: { onDone: () => void; setup?: boolean }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      props.onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard
      title={props.setup ? 'Welcome' : 'Welcome back'}
      subtitle={
        props.setup
          ? "Enter the app password set with APP_PASSWORD. You'll connect your Rivian account next."
          : 'Enter your app password to continue.'
      }
      step={props.setup ? { current: 1, total: 4 } : undefined}
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
        autoComplete="current-password"
        autoFocus
      />
    </AuthCard>
  );
}
