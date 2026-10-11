import { useEffect, useState } from 'react';
import { useRemoveTeslaMate, useSetTeslaMate, useTeslaMate } from '../../api/hooks';
import { Skeleton } from '../../components/LoadingState';
import { relativeTime } from '../../lib/freshness';
import {
  SettingRow,
  SettingsGroup,
  SettingsHero,
  dangerButton,
  secondaryButton,
} from './SettingsControls';

/** A role that can only read, for users who'd rather not share TeslaMate's own login. */
const READ_ONLY_ROLE = `CREATE ROLE rivianmate LOGIN PASSWORD 'choose-a-password';
GRANT CONNECT ON DATABASE teslamate TO rivianmate;
GRANT USAGE ON SCHEMA public TO rivianmate;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO rivianmate;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO rivianmate;`;

/**
 * Connects a TeslaMate database. RivianMate only reads from it: drives,
 * charging and live state show up as more vehicles in the picker.
 */
export function TeslaMatePanel() {
  const { data, isPending } = useTeslaMate();
  const save = useSetTeslaMate();
  const remove = useRemoveTeslaMate();
  const [url, setUrl] = useState('');
  const [editing, setEditing] = useState(false);
  // "just now" stays current between status refreshes.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const configured = data?.configured ?? false;
  const showForm = !configured || editing;
  const vehicles = data?.vehicles ?? [];

  const hero = isPending ? (
    <SettingsHero eyebrow="TeslaMate" headline={<Skeleton className="w-[8em]" />} />
  ) : !configured ? (
    <SettingsHero
      eyebrow="Not connected"
      headline="Add your Tesla from TeslaMate"
      detail="Point RivianMate at TeslaMate’s database to see its cars here, with live drives and charging."
    />
  ) : data?.error ? (
    <SettingsHero
      tone="critical"
      eyebrow="Can’t read TeslaMate"
      headline={data.error}
      detail={
        data.lastReadAt
          ? `Last read ${relativeTime(new Date(data.lastReadAt), now)}. Retrying on its own.`
          : 'Retrying on its own.'
      }
    />
  ) : (
    <SettingsHero
      tone="good"
      eyebrow="Connected · read-only"
      headline={`${vehicles.length} ${vehicles.length === 1 ? 'vehicle' : 'vehicles'}`}
      detail={
        data?.lastReadAt
          ? `Last read ${relativeTime(new Date(data.lastReadAt), now)}`
          : 'Waiting for the first read'
      }
    />
  );

  return (
    <>
      {hero}

      <SettingsGroup
        title="Database"
        note="RivianMate opens a read-only session and never writes to TeslaMate. Its data stays where it is; nothing is copied."
      >
        {configured && !editing && (
          <SettingRow
            label="Connection"
            description={<span className="break-all font-mono">{data?.preview ?? 'Saved'}</span>}
          >
            <button className={secondaryButton} onClick={() => setEditing(true)}>
              Change
            </button>
            <button
              className={dangerButton}
              disabled={remove.isPending}
              onClick={() => {
                if (!confirm('Stop showing TeslaMate vehicles? Nothing in TeslaMate changes.'))
                  return;
                remove.mutate();
              }}
            >
              Remove
            </button>
          </SettingRow>
        )}
        {showForm && (
          <form
            className="px-4 py-3.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (!url.trim()) return;
              save.mutate(url.trim(), {
                onSuccess: () => {
                  setUrl('');
                  setEditing(false);
                },
              });
            }}
          >
            <label htmlFor="teslamate-url" className="text-sm font-medium">
              Database URL
            </label>
            <p className="mt-0.5 text-xs text-(--text-muted)">
              The Postgres database TeslaMate writes to. It has to be reachable from RivianMate’s
              container, e.g. by publishing port 5432 or joining the same Docker network.
            </p>
            <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
              <input
                id="teslamate-url"
                type="text"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="postgres://teslamate:password@192.168.1.10:5432/teslamate"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                aria-invalid={save.isError}
                aria-describedby={save.isError ? 'teslamate-error' : undefined}
                className="min-w-0 flex-1 rounded-md border border-(--border) bg-(--surface-2) px-2.5 py-1.5 font-mono text-sm outline-none focus:border-(--text-muted)"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={!url.trim() || save.isPending}
                >
                  {save.isPending ? 'Checking…' : configured ? 'Save' : 'Connect'}
                </button>
                {editing && (
                  <button
                    type="button"
                    className={secondaryButton}
                    onClick={() => {
                      setEditing(false);
                      setUrl('');
                      save.reset();
                    }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
            {save.isError && (
              <p
                id="teslamate-error"
                role="alert"
                className="mt-2 text-xs text-(--status-critical)"
              >
                {save.error.message}
              </p>
            )}
          </form>
        )}
      </SettingsGroup>

      {configured && vehicles.length > 0 && (
        <SettingsGroup
          title={vehicles.length > 1 ? 'Vehicles' : 'Vehicle'}
          note="Pick them from the vehicle menu at the top of the page."
        >
          {vehicles.map((v) => (
            <SettingRow
              key={v.id}
              label={v.name ?? v.model ?? 'Tesla'}
              description={[v.modelYear, v.model].filter(Boolean).join(' ')}
            >
              <span className="select-all font-mono text-xs tracking-wide text-(--text-secondary)">
                {v.vin}
              </span>
            </SettingRow>
          ))}
        </SettingsGroup>
      )}

      <SettingsGroup title="Read-only user (optional)">
        <div className="px-4 py-3.5">
          <p className="text-xs text-(--text-muted)">
            RivianMate’s session is read-only whichever user you use. To also limit it on
            TeslaMate’s side, create a user that can only read, as TeslaMate’s database owner:
          </p>
          <pre className="mt-2.5 overflow-x-auto rounded-md bg-(--surface-2) p-3 font-mono text-xs leading-relaxed text-(--text-secondary)">
            {READ_ONLY_ROLE}
          </pre>
        </div>
      </SettingsGroup>
    </>
  );
}
