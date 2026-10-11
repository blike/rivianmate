import { useState } from 'react';
import { passwordProblem } from '@server/password-policy';
import { ApiError, api } from '../../api/client';
import { TextField } from '../../components/AuthCard';
import { PasswordHint } from '../../components/PasswordHint';
import { SettingRow, SettingsGroup, secondaryButton } from './SettingsControls';

export function SecuritySection() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const changePassword = async () => {
    setMessage(null);
    try {
      await api.changePassword(current, next);
      setCurrent('');
      setNext('');
      setMessage({ ok: true, text: 'Password updated' });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : 'Failed to update' });
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
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="submit"
              className="btn-primary"
              disabled={!current || passwordProblem(next) !== null}
            >
              Change password
            </button>
            {message && (
              <p
                role={message.ok ? 'status' : 'alert'}
                className="text-sm"
                style={{ color: message.ok ? 'var(--status-good)' : 'var(--status-critical)' }}
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
