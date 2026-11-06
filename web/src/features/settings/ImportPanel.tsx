import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { type ImportBatchDto, type VehicleDto, api } from '../../api/client';
import { useImports, useRefreshAfterImport } from '../../api/hooks';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DiscardUploadDialog, ImportFlow, type ImportStep } from './ImportFlow';
import { plural } from '../../lib/format';
import { SettingRow, SettingsGroup, dangerButton, secondaryButton } from './SettingsControls';

export function batchSummary(batch: ImportBatchDto): string {
  if (batch.status === 'running') return `Importing… ${Math.round((batch.progress ?? 0) * 100)}%`;
  if (batch.status === 'failed') return batch.error ?? 'Failed';
  const c = batch.counts;
  if (!c) return 'Done';
  const added = [
    plural(c.drives, 'drive'),
    plural(c.sessions, 'charge'),
    plural(c.locationPoints, 'location point'),
    plural(c.stateChanges, 'state change'),
  ].join(', ');
  return c.sessionsEnriched > 0
    ? `${added}; added detail to ${plural(c.sessionsEnriched, 'charge')}`
    : added;
}

/** Imports so far and any upload waiting, and the way into a new import. */
export function ImportPanel(props: { vehicles: readonly VehicleDto[] }) {
  const { data, error } = useImports();
  const refresh = useRefreshAfterImport();
  const [flowStep, setFlowStep] = useState<ImportStep | null>(null);
  const [undoing, setUndoing] = useState<ImportBatchDto | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const undo = useMutation({
    mutationFn: (id: number) => api.undoImport(id),
    onSuccess: () => {
      setUndoing(null);
      void refresh();
    },
  });
  const running = data?.batches.some((b) => b.status === 'running') ?? false;
  // Everything else on the page was read before this import's rows existed.
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running) void refresh();
    wasRunning.current = running;
  }, [running, refresh]);
  const rivians = props.vehicles.filter((v) => v.source === 'rivian');
  const nameOf = (id: string) => {
    const v = rivians.find((r) => r.id === id);
    return v?.name ?? v?.model ?? 'Vehicle';
  };
  const draft = data?.draft ?? null;
  const batches = data?.batches ?? [];

  // Until it's known, "no imports yet" could hide a waiting upload.
  if (!data) {
    return (
      <SettingsGroup title="Imports">
        {error ? (
          <div role="alert" className="px-4 py-3 text-sm text-(--status-critical)">
            {error.message}
          </div>
        ) : (
          <SettingRow label="Loading imports…" />
        )}
      </SettingsGroup>
    );
  }

  if (flowStep) {
    return (
      <ImportFlow
        vehicles={rivians}
        draft={draft}
        running={running}
        initialStep={flowStep}
        onChange={refresh}
        onExit={() => setFlowStep(null)}
        onStarted={() => setFlowStep(null)}
      />
    );
  }

  return (
    <>
      {draft && (
        <SettingsGroup title="Waiting to import">
          <SettingRow
            label={draft.files.join(', ')}
            description="Uploaded but not imported. Files stay on your server until you import or discard them, or the server restarts."
          >
            <button className={dangerButton} onClick={() => setDiscarding(true)}>
              Discard
            </button>
            <button className={secondaryButton} onClick={() => setFlowStep('settings')}>
              Continue
            </button>
          </SettingRow>
        </SettingsGroup>
      )}
      <SettingsGroup
        title="Imports"
        // One upload waits at a time, so a waiting one is continued or discarded first.
        action={
          !draft && (
            <button
              className={secondaryButton}
              disabled={rivians.length === 0}
              onClick={() => setFlowStep('source')}
            >
              New import
            </button>
          )
        }
        note={rivians.length === 0 ? 'Connect your Rivian account to import.' : undefined}
      >
        {batches.length === 0 && (
          <SettingRow
            label="No imports yet"
            description="Bring in drives, charges and history from another app."
          />
        )}
        {batches.map((batch) => (
          <SettingRow
            key={batch.id}
            label={`${nameOf(batch.vehicleId)}: ${batch.from} to ${batch.to}`}
            description={batchSummary(batch)}
          >
            {batch.status !== 'running' && (
              <button
                className={secondaryButton}
                disabled={running}
                onClick={() => {
                  undo.reset();
                  setUndoing(batch);
                }}
              >
                {batch.status === 'failed' ? 'Remove' : 'Undo'}
              </button>
            )}
          </SettingRow>
        ))}
      </SettingsGroup>
      <ConfirmDialog
        open={undoing != null}
        title="Undo this import?"
        confirmLabel="Undo import"
        busy={undo.isPending}
        onConfirm={() => undoing && undo.mutate(undoing.id)}
        onCancel={() => setUndoing(null)}
      >
        Removes the drives, charges and history it added, and clears what it filled in on charges
        you already had. A value that has changed since stays.
        {undo.isError && <p className="mt-2 text-(--status-critical)">{undo.error.message}</p>}
      </ConfirmDialog>
      <DiscardUploadDialog
        open={discarding}
        draftId={draft?.id}
        onCancel={() => setDiscarding(false)}
        onDiscarded={() => {
          setDiscarding(false);
          return refresh();
        }}
      />
    </>
  );
}
