import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  type ImportBatchDto,
  type ImportDraftDto,
  type ImportPreviewDto,
  type VehicleDto,
  api,
} from '../../api/client';
import { useImports, useRefreshAfterImport } from '../../api/hooks';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ImportPreviewList } from './ImportPreviewList';
import {
  Select,
  SettingRow,
  SettingsGroup,
  dangerButton,
  secondaryButton,
} from './SettingsControls';

const fieldClass = 'rounded-lg border border-(--border) bg-(--surface-2) px-3 py-1.5 text-sm';

/** Wider than any export, for reading what its files cover. */
const ALL_DATES = { from: '0001-01-01', to: '9999-12-31' };

const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The browser's list, with the zone given first if it isn't in it (some omit UTC). */
export function timeZoneOptions(current: string): string[] {
  const known = Intl.supportedValuesOf('timeZone');
  return known.includes(current) ? known : [current, ...known];
}

const plural = (n: number, one: string) => `${n.toLocaleString()} ${one}${n === 1 ? '' : 's'}`;

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

/** Upload, choose, preview and start, then past imports with their undo. */
export function ImportPanel(props: { vehicles: readonly VehicleDto[] }) {
  const { data } = useImports();
  const refresh = useRefreshAfterImport();
  const [undoing, setUndoing] = useState<ImportBatchDto | null>(null);
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

  return (
    <>
      <ImportForm
        key={data?.draft?.id ?? 'none'}
        vehicles={rivians}
        draft={data?.draft ?? null}
        running={running}
        onChange={refresh}
      />
      {(data?.batches.length ?? 0) > 0 && (
        <SettingsGroup title="Past imports">
          {data!.batches.map((batch) => (
            <SettingRow
              key={batch.id}
              label={`${nameOf(batch.vehicleId)}: ${batch.from} to ${batch.to}`}
              description={batchSummary(batch)}
            >
              {batch.status !== 'running' && (
                <button
                  className={secondaryButton}
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
      )}
      <ConfirmDialog
        open={undoing != null}
        title="Undo this import?"
        confirmLabel="Undo import"
        busy={undo.isPending}
        onConfirm={() => undoing && undo.mutate(undoing.id)}
        onCancel={() => setUndoing(null)}
      >
        Removes the drives, charges and history it added. Blanks it filled in on charges you already
        had stay filled in.
        {undo.isError && <p className="mt-2 text-(--status-critical)">{undo.error.message}</p>}
      </ConfirmDialog>
    </>
  );
}

function ImportForm(props: {
  vehicles: readonly VehicleDto[];
  draft: ImportDraftDto | null;
  running: boolean;
  onChange: () => unknown;
}) {
  const { draft } = props;
  const [vehicleId, setVehicleId] = useState(props.vehicles[0]?.id ?? '');
  const [timeZone, setTimeZone] = useState(browserTimeZone);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [narrowed, setNarrowed] = useState(false);
  const [covered, setCovered] = useState<{ first: string | null; last: string | null } | null>(
    null,
  );
  const chosen = vehicleId || props.vehicles[0]?.id || '';

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      let id = draft?.id;
      for (const file of files) id = (await api.uploadImportFile(file, id)).id;
    },
    onSettled: props.onChange,
  });
  const selection = draft && { draftId: draft.id, vehicleId: chosen, timeZone, from, to };
  const preview = useMutation({
    mutationFn: (input: { vehicleId: string; timeZone: string; from: string; to: string }) =>
      api.previewImport({ draftId: draft!.id, ...input }),
  });
  // Until the owner narrows them, the dates follow what the files cover, which
  // depends on the zone. Reading the files for them also gives the first preview.
  const draftId = draft?.id;
  const fileCount = draft?.files.length;
  const readFiles = preview.mutate;
  useEffect(() => {
    if (!draftId || !chosen || narrowed) return;
    readFiles(
      { vehicleId: chosen, timeZone, ...ALL_DATES },
      {
        onSuccess: (result: ImportPreviewDto) => {
          setCovered({ first: result.firstDate, last: result.lastDate });
          setFrom(result.firstDate ?? '');
          setTo(result.lastDate ?? '');
        },
      },
    );
  }, [draftId, fileCount, chosen, timeZone, narrowed, readFiles]);
  const start = useMutation({
    mutationFn: () => api.startImport(selection!),
    onSuccess: props.onChange,
  });
  const discard = useMutation({
    mutationFn: () => api.discardImportDraft(draft!.id),
    onSuccess: props.onChange,
  });

  const stale = () => preview.reset();
  const look = preview.data;
  const datesValid = !!from && !!to && from <= to;
  const ready = !!look && datesValid;
  const summary = look ? importSummary(look) : null;
  const readingForDates = preview.isPending && !narrowed;
  const narrow = (set: (value: string) => void, value: string) => {
    set(value);
    setNarrowed(true);
    stale();
  };
  const error = upload.error ?? preview.error ?? start.error ?? discard.error;

  return (
    <SettingsGroup title="ElectraFi export">
      <SettingRow
        label="Export files"
        description={
          draft
            ? draft.files.join(', ')
            : 'In ElectraFi, go to Settings → Account → Advanced → Download Data and choose Download All. Add the .csv or .csv.gz files it gives you.'
        }
      >
        <label className={`${secondaryButton} cursor-pointer`}>
          {upload.isPending ? 'Uploading…' : draft ? 'Add more' : 'Choose files'}
          <input
            type="file"
            multiple
            accept=".csv,.gz,text/csv,application/gzip"
            className="sr-only"
            disabled={upload.isPending}
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = '';
              stale();
              // More files can cover more dates.
              setNarrowed(false);
              if (files.length > 0) upload.mutate(files);
            }}
          />
        </label>
        {draft && (
          <button
            className={dangerButton}
            disabled={discard.isPending}
            onClick={() => discard.mutate()}
          >
            Discard
          </button>
        )}
      </SettingRow>
      {draft && (
        <>
          <SettingRow
            label="Vehicle"
            htmlFor="import-vehicle"
            description="ElectraFi is one account per car, so choose which one this is."
            below={look?.warnings.includes('odometer') && <OdometerWarning />}
          >
            <Select
              id="import-vehicle"
              label="Vehicle"
              value={chosen}
              options={props.vehicles.map((v) => ({
                value: v.id,
                label: v.name ?? `${v.modelYear ?? ''} ${v.model ?? 'Vehicle'}`.trim(),
              }))}
              onChange={(value) => {
                setVehicleId(value);
                stale();
              }}
            />
          </SettingRow>
          <SettingRow
            label="Time zone"
            htmlFor="import-zone"
            description="Exports have local times with no zone: use the one your ElectraFi account shows."
          >
            <Select
              id="import-zone"
              label="Time zone"
              value={timeZone}
              options={timeZoneOptions(timeZone)}
              onChange={(value) => {
                setTimeZone(value);
                stale();
              }}
            />
          </SettingRow>
          <SettingRow
            label="Dates"
            description={
              readingForDates
                ? 'Reading your files…'
                : `${
                    covered?.first && covered.last
                      ? `Your files cover ${formatDay(covered.first)} to ${formatDay(covered.last)}. `
                      : ''
                  }A drive or charge that starts in the range is imported whole.`
            }
          >
            <input
              type="date"
              aria-label="From"
              className={fieldClass}
              value={from}
              disabled={readingForDates}
              min={covered?.first ?? undefined}
              max={covered?.last ?? undefined}
              onChange={(e) => narrow(setFrom, e.target.value)}
            />
            <span className="text-sm text-(--text-muted)">to</span>
            <input
              type="date"
              aria-label="To"
              className={fieldClass}
              value={to}
              disabled={readingForDates}
              min={covered?.first ?? undefined}
              max={covered?.last ?? undefined}
              onChange={(e) => narrow(setTo, e.target.value)}
            />
            {narrowed && (
              <button
                className={secondaryButton}
                onClick={() => {
                  stale();
                  setNarrowed(false);
                }}
              >
                All dates
              </button>
            )}
          </SettingRow>
          {look && <PreviewRows preview={look} />}
          <SettingRow
            label={
              preview.isPending
                ? 'Reading your files…'
                : summary
                  ? summary.label
                  : 'Update the preview for these dates'
            }
            description={
              preview.isPending
                ? 'Large exports can take a minute.'
                : summary?.details.map((line) => <div key={line}>{line}</div>)
            }
          >
            {summary?.canImport ? (
              <button
                className={secondaryButton}
                disabled={!ready || !chosen || start.isPending || props.running}
                onClick={() => start.mutate()}
              >
                {props.running ? 'Import running…' : 'Import'}
              </button>
            ) : (
              !summary && (
                <button
                  className={secondaryButton}
                  disabled={preview.isPending || !chosen || !datesValid}
                  onClick={() => preview.mutate({ vehicleId: chosen, timeZone, from, to })}
                >
                  {preview.isPending ? 'Reading files…' : 'Preview'}
                </button>
              )
            )}
          </SettingRow>
          {/* Below the button, so a long list doesn't push it out of reach. */}
          {look && <ImportPreviewList preview={look} timeZone={timeZone} />}
        </>
      )}
      {props.vehicles.length === 0 && (
        <SettingRow label="No Rivian vehicles yet">
          <span className="text-xs text-(--text-muted)">Connect your Rivian account first.</span>
        </SettingRow>
      )}
      {error && (
        <div role="alert" className="px-4 py-3 text-sm text-(--status-critical)">
          {error.message}
        </div>
      )}
    </SettingsGroup>
  );
}

/** A calendar date like 2026-10-30, as "Oct 30, 2026". */
export function formatDay(date: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${date}T00:00:00Z`));
}

/** What importing the preview would do, and whether there's any point. */
export function importSummary(p: ImportPreviewDto): {
  label: string;
  details: string[];
  canImport: boolean;
} {
  const canImport = p.drivesNew + p.sessionsNew + p.sessionsEnriched + p.readingsNew > 0;
  if (!canImport) {
    return {
      label: 'Nothing new to import',
      details: ['Everything in these dates is already recorded or too recent.'],
      canImport,
    };
  }
  const also = [
    p.readingsNew > 0 && `${plural(p.readingsNew, 'history reading')}`,
    p.sessionsEnriched > 0 && `detail on ${plural(p.sessionsEnriched, 'existing charge')}`,
  ].filter(Boolean);
  return {
    label: `Import ${plural(p.drivesNew, 'drive')} and ${plural(p.sessionsNew, 'charge')}`,
    details: [
      also.length > 0 && `Also adds ${also.join(' and ')}.`,
      p.readingsRecorded > 0 &&
        `Skips ${plural(p.readingsRecorded, 'history reading')} from times RivianMate was already recording.`,
    ].filter((line): line is string => !!line),
    canImport,
  };
}

/** Anything about the files worth saying before the summary. */
export function PreviewRows(props: { preview: ImportPreviewDto }) {
  const p = props.preview;
  return (
    <>
      {p.unreadableRows > 0 && (
        <SettingRow
          label="Unreadable rows"
          description={`${plural(p.unreadableRows, 'row')} had no readable date and will be left out.`}
        />
      )}
      {p.warnings.includes('future') && (
        <Warning>
          Some rows would be in the future in this time zone, so it’s probably not the export’s.
        </Warning>
      )}
    </>
  );
}

export function OdometerWarning() {
  return (
    <p role="alert" className="mt-2.5 text-sm text-(--status-warning)">
      The odometer in this file doesn’t fit this vehicle’s recorded mileage. Check that it’s the
      right car and time zone.
    </p>
  );
}

function Warning(props: { children: string }) {
  return (
    <div role="alert" className="px-4 py-3 text-sm text-(--status-warning)">
      {props.children}
    </div>
  );
}
