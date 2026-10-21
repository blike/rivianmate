import { useState } from 'react';
import { passwordProblem } from '@server/password-policy';
import { ApiError, api } from '../../api/client';
import { AuthCard, TextField } from '../../components/AuthCard';
import { PasswordHint } from '../../components/PasswordHint';

export function SetupPage(props: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const problem = passwordProblem(password);
    if (problem) return setError(problem);
    if (password !== confirm) return setError('Passwords do not match');
    setBusy(true);
    setError(null);
    try {
      await api.setup(password);
      props.onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Setup failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard
      title="Welcome"
      subtitle="Choose a password to protect this app. You'll connect your Rivian account next."
      step={{ current: 1, total: 4 }}
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
        autoComplete="new-password"
        hint={<PasswordHint password={password} />}
        autoFocus
      />
      <TextField
        label="Confirm password"
        type="password"
        value={confirm}
        onChange={setConfirm}
        autoComplete="new-password"
      />
    </AuthCard>
  );
}
