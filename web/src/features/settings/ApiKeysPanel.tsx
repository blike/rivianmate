import { useState } from 'react';
import { ApiError, type ApiKeyDto, type CreatedApiKeyDto } from '../../api/client';
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from '../../api/hooks';
import { TextField } from '../../components/AuthCard';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Skeleton } from '../../components/LoadingState';
import { Select } from '../../components/Select';
import { dateTime, longDate } from '../../lib/format';
import { SettingRow, SettingsGroup } from './SettingsControls';

type ExpiryChoice = 'never' | '30d' | '90d' | '1y';

const EXPIRY_OPTIONS: readonly { value: ExpiryChoice; label: string }[] = [
  { value: 'never', label: 'Never' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '1y', label: '1 year' },
];

function expiryDate(choice: ExpiryChoice): string | null {
  const days = choice === '30d' ? 30 : choice === '90d' ? 90 : choice === '1y' ? 365 : null;
  return days ? new Date(Date.now() + days * 86_400_000).toISOString() : null;
}

function isExpired(key: ApiKeyDto, now: number): boolean {
  return key.expiresAt != null && Date.parse(key.expiresAt) <= now;
}

function keyMeta(key: ApiKeyDto, now: number): string {
  const parts = [
    `${key.prefix}…`,
    `Created ${longDate(key.createdAt)}`,
    key.lastUsedAt ? `Last used ${dateTime(key.lastUsedAt)}` : 'Never used',
  ];
  if (key.expiresAt) {
    parts.push(`${isExpired(key, now) ? 'Expired' : 'Expires'} ${longDate(key.expiresAt)}`);
  }
  return parts.join(' · ');
}

export function ApiKeysPanel() {
  const { data: keys = [], isPending } = useApiKeys();
  const createKey = useCreateApiKey();
  const revokeKey = useRevokeApiKey();

  const [now] = useState(() => Date.now());
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState<ExpiryChoice>('never');
  const [created, setCreated] = useState<CreatedApiKeyDto | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<ApiKeyDto | null>(null);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    createKey.mutate(
      { name: trimmed, expiresAt: expiryDate(expiry) },
      {
        onSuccess: (result) => {
          setCreated(result);
          setCopied(false);
          setName('');
          setExpiry('never');
          setAdding(false);
        },
      },
    );
  };

  const copySecret = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.key);
      setCopied(true);
    } catch {
      // Clipboard API may be unavailable on non-HTTPS origins; user can select manually.
    }
  };

  return (
    <>
      <SettingsGroup
        title="API keys"
        action={
          !adding && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                createKey.reset();
                setAdding(true);
              }}
            >
              Create key
            </button>
          )
        }
        note={
          !isPending &&
          'Read-only keys authenticate GET /api/vehicles and GET /api/vehicles/:id/summary via the Authorization: Bearer <key> header.'
        }
      >
        {created && (
          <div className="space-y-2.5 bg-(--surface-2)/60 px-4 py-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-medium">
                Key created for <span className="text-(--accent)">{created.name}</span>
              </div>
              <button
                type="button"
                className="text-xs text-(--text-muted) hover:text-(--text-primary)"
                onClick={() => setCreated(null)}
              >
                Dismiss
              </button>
            </div>
            <p className="text-xs text-(--text-secondary)">
              Copy this key now — it won’t be shown again.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-(--border) bg-(--surface-0) px-2.5 py-1.5 font-mono text-xs text-(--text-primary) select-all">
                {created.key}
              </code>
              <button type="button" className="btn-primary" onClick={() => void copySecret()}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        {adding && (
          <form
            className="max-w-lg space-y-4 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <TextField
              label="Name"
              value={name}
              onChange={setName}
              placeholder="Homepage"
              autoFocus
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Expires</div>
                <div className="text-xs text-(--text-muted)">
                  Optional expiry; keys can be revoked at any time.
                </div>
              </div>
              <Select
                label="Expiration"
                value={expiry}
                options={EXPIRY_OPTIONS}
                onChange={setExpiry}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="submit"
                className="btn-primary"
                disabled={!name.trim() || createKey.isPending}
              >
                {createKey.isPending ? 'Creating…' : 'Create key'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={createKey.isPending}
                onClick={() => {
                  createKey.reset();
                  setAdding(false);
                }}
              >
                Cancel
              </button>
              {createKey.isError && (
                <p role="alert" className="text-xs text-(--status-critical)">
                  {createKey.error instanceof ApiError
                    ? createKey.error.message
                    : 'Couldn’t create key.'}
                </p>
              )}
            </div>
          </form>
        )}

        {isPending ? (
          <SettingRow
            label={<Skeleton className="w-[7em]" />}
            description={<Skeleton className="w-[16em]" />}
          />
        ) : keys.length === 0 ? (
          !adding && (
            <div className="px-4 py-6 text-center text-sm text-(--text-muted)">
              No API keys yet. Create one to call the API from scripts or home automation without a
              browser session.
            </div>
          )
        ) : (
          keys.map((key) => {
            const expired = isExpired(key, now);
            return (
              <SettingRow
                key={key.id}
                label={
                  <span className="inline-flex items-center gap-2">
                    <span>{key.name}</span>
                    {expired && (
                      <span className="rounded bg-(--surface-2) px-1.5 py-0.5 text-[11px] font-medium text-(--status-warning)">
                        Expired
                      </span>
                    )}
                  </span>
                }
                description={keyMeta(key, now)}
              >
                <button
                  type="button"
                  className="btn-danger"
                  disabled={revokeKey.isPending}
                  onClick={() => setRevoking(key)}
                >
                  Revoke
                </button>
              </SettingRow>
            );
          })
        )}
      </SettingsGroup>

      <ConfirmDialog
        open={revoking != null}
        title={`Revoke ${revoking?.name ?? 'API key'}?`}
        confirmLabel="Revoke"
        busy={revokeKey.isPending}
        onCancel={() => setRevoking(null)}
        onConfirm={() =>
          revoking && revokeKey.mutate(revoking.id, { onSettled: () => setRevoking(null) })
        }
      >
        Any script or integration using <code className="font-mono">{revoking?.prefix}…</code> will
        immediately stop authenticating.
      </ConfirmDialog>
    </>
  );
}
