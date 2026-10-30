import type { OtaTimelineDto, VehicleState } from '@server/api-types';
import { isTeslaMateVehicle } from '@server/teslamate/ids';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../../api/client';
import { useVehicleState } from '../../api/hooks';
import { SkeletonBlock } from '../../components/LoadingState';
import { Panel } from '../../components/Panel';
import { longDate, shortDate } from '../../lib/format';
import {
  type SoftwareUpdate,
  installRecap,
  isActivePhase,
  lastInstallFailed,
  releaseNotesHref,
  reportsUpdates,
  pendingFacts,
  softwareUpdate,
  typicalUpdateGapDays,
} from '../../lib/ota';
import { sv } from '../../lib/state';

const DAY_MS = 86_400_000;
/** Earlier versions shown before the installed one; older ones are summarized. */
const MAX_PAST = 4;

const days = (ms: number) => {
  const d = Math.max(1, Math.round(ms / DAY_MS));
  return `${d} day${d === 1 ? '' : 's'}`;
};

/** How long a version has been installed: "today" until it's been a day. */
const age = (ms: number) => (ms < DAY_MS ? 'today' : days(ms));

type Version = OtaTimelineDto['versions'][number];

/** Past versions, then what's installed, then what's next, along one track. */
export function SoftwarePanel(props: { vehicleId: string }) {
  const { data: liveState, isPending: statePending } = useVehicleState(props.vehicleId);
  // Keyed by the live version and status, so an install or a new phase shows
  // up without waiting for a refetch.
  const { data: latestOta, isPending: otaPending } = useQuery({
    queryKey: [
      'ota',
      props.vehicleId,
      sv(liveState, 'otaCurrentVersion'),
      sv(liveState, 'otaStatus'),
    ],
    queryFn: () => api.otaTimeline(props.vehicleId),
    placeholderData: keepPreviousData,
    refetchInterval: 15 * 60_000,
  });
  // State and timeline arrive separately. Until both name the same installed
  // version, the last pair that did is shown, so an install doesn't pass
  // through a mix of before and after.
  const agree =
    isTeslaMateVehicle(props.vehicleId) ||
    !latestOta?.current ||
    latestOta.current === sv(liveState, 'otaCurrentVersion');
  const [held, setHeld] = useState<{ state?: VehicleState; ota?: OtaTimelineDto } | null>(null);
  if (agree && (held?.state !== liveState || held?.ota !== latestOta))
    setHeld({ state: liveState, ota: latestOta });
  const { state, ota } = agree || !held ? { state: liveState, ota: latestOta } : held;
  // Ticks for the time in the current phase and the download estimate.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  const update = softwareUpdate(state);
  const failed = lastInstallFailed(state);
  const reports = reportsUpdates(state);
  // Release notes come from Rivian, so a TeslaMate vehicle has none.
  const notes = !isTeslaMateVehicle(props.vehicleId);

  // Oldest first, so the track reads left to right into the future.
  const versions = [...(ota?.versions ?? [])].reverse();
  const current = ota?.current ?? null;
  const installedAt = versions.findIndex((v) => v.version === current);
  const installed = installedAt >= 0 ? versions[installedAt]! : null;
  const before = installedAt >= 0 ? versions.slice(0, installedAt) : versions;
  const past = before.slice(-MAX_PAST);
  const hidden = before.length - past.length;
  const gap = typicalUpdateGapDays(ota?.versions ?? []);
  // The oldest version's date is when tracking began, not when it was installed.
  const tracked = installed && installedAt === 0;
  const recap =
    ota?.lastInstall && ota.lastInstall.version === current ? installRecap(ota.lastInstall) : null;

  return (
    <Panel
      title="Software"
      action={
        gap != null && (
          <span className="text-xs text-(--text-muted)">Updates every ~{days(gap * DAY_MS)}</span>
        )
      }
    >
      {statePending || otaPending ? (
        <SkeletonBlock height="7rem" />
      ) : (
        <>
          <ol className="flex flex-col sm:flex-row">
            {hidden > 0 && (
              <Stop kind="past" grow={0.8}>
                <div className="text-sm text-(--text-muted)">{hidden} earlier</div>
                <div className="whitespace-nowrap text-xs text-(--text-muted)">
                  Since {longDate(before[0]!.firstSeen)}
                </div>
              </Stop>
            )}
            {past.map((v, i) => (
              <Stop key={v.version} kind="past" grow={1}>
                <VersionName vehicleId={props.vehicleId} version={v} />
                <div className="text-xs text-(--text-muted)">
                  {shortDate(v.firstSeen)} ·{' '}
                  {days(
                    Date.parse((past[i + 1] ?? installed ?? v).firstSeen) - Date.parse(v.firstSeen),
                  )}
                </div>
              </Stop>
            ))}
            <Stop
              kind="installed"
              // Ending the track, it takes a past version's share, not the update's.
              grow={update ? 2 : 1}
              next={update ? 'update' : undefined}
              progress={trackFill(update)}
            >
              <Eyebrow
                color={update || failed || !reports ? 'var(--text-muted)' : 'var(--status-good)'}
              >
                {update || failed || !reports ? (
                  'Installed'
                ) : (
                  <>
                    <CheckIcon /> Up to date
                  </>
                )}
              </Eyebrow>
              <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
                {current ?? '—'}
              </div>
              <div className="mt-0.5 text-sm text-(--text-secondary)">
                {installed
                  ? `${tracked ? 'Seen since' : 'Installed'} ${longDate(installed.firstSeen)} · ${age(now - Date.parse(installed.firstSeen))}`
                  : 'Waiting for the vehicle to report its version'}
              </div>
              {recap && <div className="mt-0.5 text-xs text-(--text-muted)">{recap}</div>}
              {current && notes && <NotesLink vehicleId={props.vehicleId} version={current} />}
            </Stop>
            {update && (
              <Stop kind="update" grow={2} active={isActivePhase(update.phase)}>
                <PendingDetails
                  vehicleId={props.vehicleId}
                  update={update}
                  facts={pendingFacts(update, ota?.pending, state, now)}
                  offeredAt={
                    ota?.pending && ota.pending.version === update.version
                      ? ota.pending.offeredAt
                      : null
                  }
                  now={now}
                />
              </Stop>
            )}
          </ol>
          {failed && (
            <p
              role="alert"
              className="mt-4 rounded-lg bg-[color-mix(in_srgb,var(--status-warning)_10%,transparent)] px-4 py-3 text-sm text-(--status-warning)"
            >
              The vehicle reported that its last update didn’t install. Check the Rivian app for
              details.
            </p>
          )}
        </>
      )}
    </Panel>
  );
}

/** How far the installed → update segment is filled: null while progress is unknown. */
function trackFill(update: SoftwareUpdate | null): number | null {
  if (!update) return 0;
  if (isActivePhase(update.phase)) return update.progress;
  // A download paused for a connection stays where it stopped.
  if (update.progress != null) return update.progress;
  return 100;
}

type StopKind = 'past' | 'installed' | 'update';

/**
 * One point on the track: a marker, the segment to the next point, and its
 * details. The track runs across on wide screens and down on phones.
 */
function Stop(props: {
  kind: StopKind;
  grow: number;
  /** For the installed stop: what follows it, which colors its segment. */
  next?: 'update';
  progress?: number | null;
  active?: boolean;
  children: ReactNode;
}) {
  // An installed stop with nothing after it ends the track.
  const last = props.kind === 'update' || (props.kind === 'installed' && !props.next);
  const toUpdate = props.next === 'update';
  const fill = props.progress;

  return (
    <li
      className="relative min-w-0 pb-6 pl-7 last:pb-0 sm:pb-0 sm:pl-0 sm:pr-6 sm:pt-8 sm:last:pr-0"
      style={{ flexGrow: props.grow, flexBasis: 0 }}
    >
      {!last && (
        <span
          aria-hidden
          className={`absolute overflow-hidden rounded-full max-sm:bottom-0 max-sm:left-1.25 max-sm:top-5 max-sm:w-0.5 sm:left-5 sm:right-2 sm:top-1.25 sm:h-0.5 ${
            toUpdate ? 'bg-[color-mix(in_srgb,var(--accent)_22%,transparent)]' : 'bg-(--border)'
          }`}
        >
          {toUpdate && (
            <span
              className={`ota-progress absolute left-0 top-0 rounded-full bg-(--accent) max-sm:h-(--ota-fill) max-sm:w-full sm:h-full sm:w-(--ota-fill) ${
                fill == null ? 'ota-progress--indeterminate' : ''
              }`}
              style={{ ['--ota-fill' as string]: `${fill ?? 30}%` }}
            />
          )}
        </span>
      )}
      <Marker kind={props.kind} active={props.active} />
      <div className="min-w-0">{props.children}</div>
    </li>
  );
}

function Marker(props: { kind: StopKind; active?: boolean }) {
  const base = 'absolute left-0 top-0 block h-3 w-3 rounded-full';
  switch (props.kind) {
    case 'past':
      return (
        <span aria-hidden className={`${base} border-2 border-(--text-muted) bg-(--surface-1)`} />
      );
    case 'installed':
      return (
        <span
          aria-hidden
          className={`${base} bg-(--status-good) shadow-[0_0_0_4px_color-mix(in_srgb,var(--status-good)_18%,transparent)]`}
        />
      );
    case 'update':
      return (
        <span
          aria-hidden
          className={`${base} bg-(--accent) text-(--accent) shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent)_18%,transparent)] ${
            props.active ? 'chip-dot--pulse' : ''
          }`}
        />
      );
  }
}

function PendingDetails(props: {
  vehicleId: string;
  update: SoftwareUpdate;
  facts: string[];
  /** When the vehicle was first offered this update. */
  offeredAt: string | null;
  now: number;
}) {
  const { update, facts, offeredAt } = props;

  return (
    <>
      <Eyebrow color="var(--accent)">{update.label}</Eyebrow>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
        {update.version ?? 'New version'}
      </div>
      {offeredAt && (
        <div className="mt-0.5 text-sm text-(--text-secondary)">
          Available {longDate(offeredAt)} · {age(props.now - Date.parse(offeredAt))}
        </div>
      )}
      {facts.length > 0 && (
        <div className="mt-0.5 text-xs text-(--text-muted)">{facts.join(' · ')}</div>
      )}
      {update.version && <NotesLink vehicleId={props.vehicleId} version={update.version} />}
    </>
  );
}

function Eyebrow(props: { color: string; children: ReactNode }) {
  return (
    <div
      className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide"
      style={{ color: props.color }}
    >
      {props.children}
    </div>
  );
}

/** A past version's number, linking to its notes when they were saved. */
function VersionName(props: { vehicleId: string; version: Version }) {
  const { version } = props.version;
  if (!props.version.hasNotes)
    return <div className="flex text-sm tabular-nums text-(--text-secondary)">{version}</div>;
  return (
    <a
      href={releaseNotesHref(props.vehicleId, version)}
      target="_blank"
      rel="noreferrer noopener"
      title="Release notes"
      className="flex w-fit items-center gap-1 text-sm tabular-nums text-(--text-secondary) underline-offset-4 hover:text-(--text-primary) hover:underline"
    >
      {version}
      <ArrowIcon />
    </a>
  );
}

function NotesLink(props: { vehicleId: string; version: string }) {
  return (
    <a
      href={releaseNotesHref(props.vehicleId, props.version)}
      target="_blank"
      rel="noreferrer noopener"
      className="mt-2 inline-flex items-center gap-1 text-xs text-(--text-secondary) underline-offset-4 transition-colors hover:text-(--text-primary) hover:underline"
    >
      Release notes
      <ArrowIcon />
    </a>
  );
}

function ArrowIcon() {
  return (
    <svg
      viewBox="0 0 12 12"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden
    >
      <path d="M4.5 2.5h5v5M9.5 2.5l-7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      aria-hidden
    >
      <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
