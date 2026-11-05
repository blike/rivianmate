import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { type ImportDraftDto, type ImportPreviewDto, type VehicleDto, api } from '../../api/client';
import { StepDots } from '../../components/AuthCard';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ImportPreviewList } from './ImportPreviewList';
import { Select } from '../../components/Select';
import { SettingRow, secondaryButton } from './SettingsControls';

const fieldClass = 'rounded-lg border border-(--border) bg-(--surface-2) px-3 py-1.5 text-sm';
const primaryButton = 'btn-primary rounded-md px-3 py-1.5 text-sm font-medium';
const textButton =
  'font-medium text-(--text-secondary) underline decoration-dotted underline-offset-2 hover:text-(--text-primary) disabled:opacity-50';

/** Wider than any export, for reading what its files cover. */
const ALL_DATES = { from: '0001-01-01', to: '9999-12-31' };

const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The browser's list, with the zone given first if it isn't in it (some omit UTC). */
export function timeZoneOptions(current: string): string[] {
  const known = Intl.supportedValuesOf('timeZone');
  return known.includes(current) ? known : [current, ...known];
}

const plural = (n: number, one: string) => `${n.toLocaleString()} ${one}${n === 1 ? '' : 's'}`;

export interface ImportSource {
  id: string;
  label: string;
  description: string;
  /** Where to get the files. */
  instructions: string;
  accept: string;
  vehicleHelp: string;
  timeZoneHelp: string;
}

/** Each kind of export that can be imported. */
export const IMPORT_SOURCES: readonly ImportSource[] = [
  {
    id: 'electrafi',
    label: 'ElectraFi',
    description: 'Drives, charges, routes and vehicle history.',
    instructions:
      'In ElectraFi, go to Settings → Account → Advanced → Download Data and choose Download All. Add the .csv or .csv.gz files it gives you.',
    accept: '.csv,.gz,text/csv,application/gzip',
    vehicleHelp: 'ElectraFi is one account per car, so choose which one this is.',
    timeZoneHelp:
      'Exports have local times with no zone: use the one your ElectraFi account shows.',
  },
];

export const IMPORT_STEPS = [
  { id: 'source', label: 'Source' },
  { id: 'files', label: 'Files' },
  { id: 'settings', label: 'Settings' },
  { id: 'review', label: 'Review' },
] as const;
export type ImportStep = (typeof IMPORT_STEPS)[number]['id'];

/** The step to show: the later ones need files, and an upload can go in a restart. */
export function reachableStep(step: ImportStep, hasDraft: boolean): ImportStep {
  return !hasDraft && (step === 'settings' || step === 'review') ? 'files' : step;
}

interface ImportChoices {
  draftId: string;
  vehicleId: string;
  timeZone: string;
  from: string;
  to: string;
  narrowed: boolean;
  covered: { first: string | null; last: string | null } | null;
}

const CHOICES_KEY = 'rivianmate.importChoices';

/** What was chosen for this upload before leaving the page, if anything. */
function loadChoices(draftId: string | undefined): ImportChoices | null {
  try {
    const saved = JSON.parse(localStorage.getItem(CHOICES_KEY) ?? 'null') as ImportChoices | null;
    return saved && saved.draftId === draftId ? saved : null;
  } catch {
    return null;
  }
}

function saveChoices(choices: ImportChoices): void {
  try {
    localStorage.setItem(CHOICES_KEY, JSON.stringify(choices));
  } catch {
    // Only a convenience: they'd be chosen again on the way back.
  }
}

/** Confirms and discards an upload that's waiting. */
export function DiscardUploadDialog(props: {
  open: boolean;
  draftId: string | undefined;
  onCancel: () => void;
  onDiscarded: () => unknown;
}) {
  const discard = useMutation({
    mutationFn: (id: string) => api.discardImportDraft(id),
    onSuccess: props.onDiscarded,
  });
  return (
    <ConfirmDialog
      open={props.open}
      title="Discard this upload?"
      confirmLabel="Discard"
      busy={discard.isPending}
      onConfirm={() => props.draftId && discard.mutate(props.draftId)}
      onCancel={props.onCancel}
    >
      Deletes the uploaded files from your server. Nothing has been imported from them.
      {discard.isError && <p className="mt-2 text-(--status-critical)">{discard.error.message}</p>}
    </ConfirmDialog>
  );
}

/**
 * The steps of one import: source, files, settings, then a review to start it
 * from. Uploads wait on the server, so leaving keeps them; `onExit` returns to
 * the list of imports, and `onStarted` follows the import there.
 */
export function ImportFlow(props: {
  vehicles: readonly VehicleDto[];
  draft: ImportDraftDto | null;
  running: boolean;
  initialStep: ImportStep;
  onChange: () => unknown;
  onExit: () => void;
  onStarted: () => void;
}) {
  const { draft } = props;
  const [saved] = useState(() => loadChoices(draft?.id));
  const [requestedStep, setStep] = useState<ImportStep>(props.initialStep);
  const step = reachableStep(requestedStep, !!draft);
  const [sourceId, setSourceId] = useState(IMPORT_SOURCES[0]!.id);
  const source = IMPORT_SOURCES.find((s) => s.id === sourceId) ?? IMPORT_SOURCES[0]!;
  const [vehicleId, setVehicleId] = useState(saved?.vehicleId ?? '');
  const [timeZone, setTimeZone] = useState(saved?.timeZone ?? browserTimeZone());
  const [from, setFrom] = useState(saved?.from ?? '');
  const [to, setTo] = useState(saved?.to ?? '');
  const [narrowed, setNarrowed] = useState(saved?.narrowed ?? false);
  const [covered, setCovered] = useState(saved?.covered ?? null);
  const [discarding, setDiscarding] = useState(false);
  const [uploading, setUploading] = useState<{ at: number; of: number } | null>(null);
  const chosen = props.vehicles.some((v) => v.id === vehicleId)
    ? vehicleId
    : (props.vehicles[0]?.id ?? '');

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      let id = draft?.id;
      for (const [i, file] of files.entries()) {
        setUploading({ at: i + 1, of: files.length });
        id = (await api.uploadImportFile(file, id)).id;
      }
    },
    onSettled: () => {
      setUploading(null);
      return props.onChange();
    },
  });
  const preview = useMutation({
    mutationFn: (input: { vehicleId: string; timeZone: string; from: string; to: string }) =>
      api.previewImport({ draftId: draft!.id, ...input }),
  });
  // Until the owner narrows them, the dates follow what the files cover, which
  // depends on the zone. Reading the files for them also gives the first preview.
  const draftId = draft?.id;
  const fileCount = draft?.files.length;
  const readFiles = preview.mutate;
  const choosing = step === 'settings' || step === 'review';
  useEffect(() => {
    if (!choosing || !draftId || !chosen || narrowed) return;
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
  }, [choosing, draftId, fileCount, chosen, timeZone, narrowed, readFiles]);
  useEffect(() => {
    if (!draftId) return;
    saveChoices({ draftId, vehicleId: chosen, timeZone, from, to, narrowed, covered });
  }, [draftId, chosen, timeZone, from, to, narrowed, covered]);
  const start = useMutation({
    mutationFn: () =>
      api.startImport({ draftId: draft!.id, vehicleId: chosen, timeZone, from, to }),
    onSuccess: () => {
      props.onStarted();
      return props.onChange();
    },
  });

  // The heading takes focus, so a keyboard or screen reader follows each step.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [step]);

  const stale = () => preview.reset();
  const look = preview.data;
  const datesValid = !!from && !!to && from <= to;
  const summary = look ? importSummary(look) : null;
  const readingForDates = preview.isPending && !narrowed;
  const narrow = (set: (value: string) => void, value: string) => {
    set(value);
    setNarrowed(true);
    stale();
  };
  const toReview = () => {
    if (!look) preview.mutate({ vehicleId: chosen, timeZone, from, to });
    setStep('review');
  };
  const error = upload.error ?? preview.error ?? start.error;
  const stepNumber = IMPORT_STEPS.findIndex((s) => s.id === step) + 1;
  const title = {
    source: 'Where is this import from?',
    files: `Add your ${source.label} files`,
    settings: 'Choose what to import',
    review: 'Check and import',
  }[step];

  return (
    <>
      <section aria-label="New import" className="card min-w-0 divide-y divide-(--border)">
        <div className="px-4 py-4">
          <StepDots current={stepNumber} total={IMPORT_STEPS.length} />
          <h4
            ref={heading}
            tabIndex={-1}
            aria-label={`Step ${stepNumber} of ${IMPORT_STEPS.length}: ${title}`}
            className="text-lg font-semibold tracking-tight outline-none"
          >
            {title}
          </h4>
        </div>

        {step === 'source' && (
          <fieldset className="divide-y divide-(--border)">
            <legend className="sr-only">Source</legend>
            {IMPORT_SOURCES.map((s) => (
              <label key={s.id} className="flex cursor-pointer items-start gap-3 px-4 py-3">
                <input
                  type="radio"
                  name="import-source"
                  className="mt-1"
                  checked={s.id === source.id}
                  onChange={() => setSourceId(s.id)}
                />
                <span>
                  <span className="block text-sm font-medium">{s.label}</span>
                  <span className="block text-xs text-(--text-muted)">{s.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}

        {step === 'files' && (
          <SettingRow
            label="Export files"
            description={draft ? draft.files.join(', ') : source.instructions}
          >
            <label
              className={`${draft ? secondaryButton : primaryButton} cursor-pointer focus-within:outline-2`}
            >
              {uploading
                ? `Uploading ${uploading.at} of ${uploading.of}…`
                : draft
                  ? 'Add more'
                  : 'Choose files'}
              <input
                type="file"
                multiple
                accept={source.accept}
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
          </SettingRow>
        )}

        {step === 'settings' && (
          <>
            <SettingRow label="Vehicle" htmlFor="import-vehicle" description={source.vehicleHelp}>
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
            <SettingRow label="Time zone" htmlFor="import-zone" description={source.timeZoneHelp}>
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
                  ? 'Reading your files… Large exports can take a minute.'
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
          </>
        )}

        {step === 'review' && (
          <div className="px-4 py-3.5">
            <p className="text-sm font-medium">
              {preview.isPending ? 'Reading your files…' : (summary?.label ?? 'No preview yet')}
            </p>
            <div className="mt-1 text-sm text-(--text-secondary)">
              {preview.isPending
                ? 'Large exports can take a minute.'
                : summary?.details.map((line) => <div key={line}>{line}</div>)}
            </div>
          </div>
        )}
        {step === 'review' && look?.warnings.includes('odometer') && <OdometerWarning />}
        {step === 'review' && look && <PreviewRows preview={look} />}

        {error && (
          <div role="alert" className="px-4 py-3 text-sm text-(--status-critical)">
            {error.message}
          </div>
        )}

        {/* Above the review's list, so its length never puts these out of reach. */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
            {step !== 'source' && (
              <button
                className={textButton}
                disabled={upload.isPending || start.isPending}
                onClick={() => setStep(IMPORT_STEPS[stepNumber - 2]!.id)}
              >
                Back
              </button>
            )}
            <button
              className={textButton}
              disabled={upload.isPending || start.isPending}
              onClick={props.onExit}
            >
              {draft ? 'Save for later' : 'Cancel'}
            </button>
            {draft && (
              <button
                className={
                  'font-medium text-(--status-critical) underline decoration-dotted underline-offset-2 disabled:opacity-50'
                }
                disabled={upload.isPending || start.isPending}
                onClick={() => setDiscarding(true)}
              >
                Discard upload
              </button>
            )}
          </div>

          {step === 'source' && (
            <button className={primaryButton} onClick={() => setStep('files')}>
              Continue
            </button>
          )}
          {step === 'files' && (
            <button
              className={primaryButton}
              disabled={!draft || upload.isPending}
              onClick={() => setStep('settings')}
            >
              Continue
            </button>
          )}
          {step === 'settings' && (
            <button
              className={primaryButton}
              disabled={!chosen || !datesValid || readingForDates}
              onClick={toReview}
            >
              Review
            </button>
          )}
          {step === 'review' && summary?.canImport && (
            <button
              className={primaryButton}
              disabled={preview.isPending || start.isPending || props.running}
              onClick={() => start.mutate()}
            >
              {props.running ? 'Import running…' : 'Import'}
            </button>
          )}
        </div>

        {step === 'review' && look && <ImportPreviewList preview={look} timeZone={timeZone} />}
      </section>
      <DiscardUploadDialog
        open={discarding}
        draftId={draft?.id}
        onCancel={() => setDiscarding(false)}
        onDiscarded={() => {
          props.onExit();
          return props.onChange();
        }}
      />
    </>
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
    <p role="alert" className="px-4 py-3 text-sm text-(--status-warning)">
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
