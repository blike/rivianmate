import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  useRemoveTeslaMate,
  useRivianDisconnect,
  useSetTeslaMate,
  useStatus,
  useTeslaMate,
} from '../../api/hooks';
import { Dot } from '../../components/Dot';
import { Skeleton } from '../../components/LoadingState';
import { relativeTime } from '../../lib/freshness';
import { RivianConnectPage } from '../auth/RivianConnectPage';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { SettingRow, SettingsGroup, dangerButton, secondaryButton } from './SettingsControls';

type Kind = 'rivian' | 'teslamate';

/**
 * Where vehicles come from: the Rivian account and a TeslaMate database,
 * one row each, with their actions on the right and Add for any not yet
 * connected.
 */
export function AccountsPanel() {
  const queryClient = useQueryClient();
  const { data: status, isPending: statusPending } = useStatus();
  const { data: teslamate, isPending: teslamatePending } = useTeslaMate();
  const disconnect = useRivianDisconnect();
  const remove = useRemoveTeslaMate();
  const [editingTeslaMate, setEditingTeslaMate] = useState(false);
  const [confirming, setConfirming] = useState<Kind | null>(null);
  // Signing in to Rivian takes over the screen, as it does on first run.
  const [rivianSignIn, setRivianSignIn] = useState<'add' | 'reauth' | null>(null);
  const now = useNow();

  const rivianExpired = status?.rivianAuthState === 'unauthenticated';
  const hasRivian = status != null && (status.rivianConnected || status.rivianEmail != null);
  const hasTeslaMate = teslamate?.configured ?? false;
  const addable: Kind[] = [
    ...(!statusPending && !hasRivian ? (['rivian'] as const) : []),
    ...(!teslamatePending && !hasTeslaMate && !editingTeslaMate ? (['teslamate'] as const) : []),
  ];
  const lastRead = teslamate?.lastReadAt ? relativeTime(new Date(teslamate.lastReadAt), now) : null;

  if (rivianSignIn) {
    return (
      <div className="fixed inset-0 z-1200 overflow-auto bg-(--surface-0)">
        <button
          type="button"
          className={`${secondaryButton} absolute right-4 top-4 z-10`}
          onClick={() => setRivianSignIn(null)}
        >
          Cancel
        </button>
        <RivianConnectPage
          mockMode={status?.mockMode ?? false}
          reauth={rivianSignIn === 'reauth'}
          email={status?.rivianEmail}
          onDone={() => {
            setRivianSignIn(null);
            void queryClient.invalidateQueries();
          }}
        />
      </div>
    );
  }

  return (
    <SettingsGroup
      title="Accounts"
      action={
        <AddMenu
          options={addable}
          onPick={(kind) =>
            kind === 'rivian' ? setRivianSignIn('add') : setEditingTeslaMate(true)
          }
        />
      }
    >
      {statusPending || teslamatePending ? (
        <SettingRow
          label={<Skeleton className="w-[10em]" />}
          description={<Skeleton className="w-[6em]" />}
        />
      ) : (
        <>
          {hasRivian && (
            <SettingRow
              label={status.rivianEmail ?? 'Rivian account'}
              description={
                <Status
                  source="Rivian"
                  color={rivianExpired ? 'var(--status-warning)' : 'var(--status-good)'}
                >
                  {rivianExpired ? 'Signed out' : 'Connected'}
                  {status.mockMode && ' · Simulated vehicle'}
                </Status>
              }
            >
              {rivianExpired && (
                <button className={secondaryButton} onClick={() => setRivianSignIn('reauth')}>
                  Reconnect
                </button>
              )}
              <button
                className={dangerButton}
                disabled={disconnect.isPending}
                onClick={() => setConfirming('rivian')}
              >
                Disconnect
              </button>
            </SettingRow>
          )}

          {(hasTeslaMate || editingTeslaMate) && (
            <SettingRow
              label={
                hasTeslaMate ? (
                  <span className="break-all font-mono">
                    {teslamate?.preview ?? 'TeslaMate database'}
                  </span>
                ) : (
                  'TeslaMate'
                )
              }
              description={
                !hasTeslaMate ? (
                  'Add the Postgres database TeslaMate writes to.'
                ) : teslamate?.error ? (
                  <>
                    <Status source="TeslaMate" color="var(--status-critical)">
                      <span className="text-(--status-critical)">{teslamate.error}</span>
                    </Status>
                    <span className="block">
                      {lastRead ? `Last read ${lastRead}. ` : ''}Retrying on its own.
                    </span>
                  </>
                ) : (
                  <Status source="TeslaMate" color="var(--status-good)">
                    Connected
                  </Status>
                )
              }
              below={
                editingTeslaMate && (
                  <TeslaMateForm
                    replacing={hasTeslaMate}
                    onDone={() => setEditingTeslaMate(false)}
                  />
                )
              }
            >
              {hasTeslaMate && !editingTeslaMate && (
                <>
                  <button className={secondaryButton} onClick={() => setEditingTeslaMate(true)}>
                    Edit
                  </button>
                  <button
                    className={dangerButton}
                    disabled={remove.isPending}
                    onClick={() => setConfirming('teslamate')}
                  >
                    Disconnect
                  </button>
                </>
              )}
            </SettingRow>
          )}

          {!hasRivian && !hasTeslaMate && !editingTeslaMate && (
            <SettingRow label="No accounts" description="Add one to start tracking a vehicle." />
          )}

          <ConfirmDialog
            open={confirming === 'rivian'}
            title="Disconnect your Rivian account?"
            confirmLabel="Disconnect"
            busy={disconnect.isPending}
            onCancel={() => setConfirming(null)}
            onConfirm={() => disconnect.mutate(undefined, { onSettled: () => setConfirming(null) })}
          >
            Tracking stops and RivianMate forgets your Rivian sign-in. Your recorded history stays.
          </ConfirmDialog>
          <ConfirmDialog
            open={confirming === 'teslamate'}
            title="Remove TeslaMate?"
            confirmLabel="Remove"
            busy={remove.isPending}
            onCancel={() => setConfirming(null)}
            onConfirm={() => remove.mutate(undefined, { onSettled: () => setConfirming(null) })}
          >
            Its vehicles stop showing in RivianMate. Nothing in TeslaMate changes.
          </ConfirmDialog>
        </>
      )}
    </SettingsGroup>
  );
}

/** "Rivian · Connected", with a status dot. */
function Status(props: { source: string; color: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Dot color={props.color} />
      <span>
        {props.source} · {props.children}
      </span>
    </span>
  );
}

/** The TeslaMate URL, tested by the server before it replaces a working one. */
function TeslaMateForm(props: { replacing: boolean; onDone: () => void }) {
  const save = useSetTeslaMate();
  const [url, setUrl] = useState('');
  const done = () => {
    save.reset();
    props.onDone();
  };
  return (
    <form
      className="mt-3.5 border-t border-(--border) pt-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!url.trim()) return;
        save.mutate(url.trim(), { onSuccess: done });
      }}
    >
      <label htmlFor="teslamate-url" className="text-sm font-medium">
        Database URL
      </label>
      <p className="mt-0.5 text-xs text-(--text-muted)">
        It has to be reachable from RivianMate’s container, e.g. by publishing port 5432 or joining
        the same Docker network. RivianMate only ever reads from it.
      </p>
      <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
        <input
          id="teslamate-url"
          type="text"
          autoFocus
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
          <button type="submit" className="btn-primary" disabled={!url.trim() || save.isPending}>
            {save.isPending ? 'Checking…' : props.replacing ? 'Save' : 'Connect'}
          </button>
          <button type="button" className={secondaryButton} onClick={done}>
            Cancel
          </button>
        </div>
      </div>
      {save.isError && (
        <p id="teslamate-error" role="alert" className="mt-2 text-xs text-(--status-critical)">
          {save.error.message}
        </p>
      )}
    </form>
  );
}

const ADD_LABELS: Record<Kind, { label: string; detail: string }> = {
  rivian: { label: 'Rivian', detail: 'Sign in to your Rivian account' },
  teslamate: { label: 'TeslaMate', detail: 'Read a Tesla from its database' },
};

/** "Add" with a menu of the account kinds not yet connected. */
function AddMenu(props: { options: Kind[]; onPick: (kind: Kind) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const none = props.options.length === 0;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="inline-flex items-center gap-1 text-xs font-medium text-(--accent) hover:underline disabled:cursor-default disabled:text-(--text-muted) disabled:no-underline"
        disabled={none}
        title={none ? 'Every kind of account is connected' : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <svg
          viewBox="0 0 12 12"
          className="h-3 w-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M6 2v8M2 6h8" />
        </svg>
        Add account
      </button>
      {open && !none && (
        <div
          role="menu"
          className="card absolute right-0 top-full z-30 mt-2 w-64 py-1 shadow-[0_12px_32px_rgba(0,0,0,0.45)]"
        >
          {props.options.map((kind) => (
            <button
              key={kind}
              type="button"
              role="menuitem"
              className="block w-full px-4 py-2 text-left hover:bg-(--surface-2) focus-visible:bg-(--surface-2) focus-visible:outline-none"
              onClick={() => {
                setOpen(false);
                props.onPick(kind);
              }}
            >
              <span className="block text-sm font-medium">{ADD_LABELS[kind].label}</span>
              <span className="block text-xs text-(--text-muted)">{ADD_LABELS[kind].detail}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The current time, ticking so "just now" stays current. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  return now;
}
