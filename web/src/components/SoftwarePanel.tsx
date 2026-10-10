import type { OtaTimelineDto } from "@server/api-types.js";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { api } from "../api/client.js";
import { useVehicleState } from "../api/hooks.js";
import {
  type SoftwareUpdate,
  installTimeLabel,
  lastInstallFailed,
  releaseNotesHref,
  softwareUpdate,
  typicalUpdateGapDays,
} from "../lib/ota.js";
import { Panel } from "./panels.js";
import { SkeletonBlock } from "./loading.js";

const DAY_MS = 86_400_000;
/** Earlier versions shown before the installed one; older ones are summarized. */
const MAX_PAST = 4;

const shortDate = (iso: string) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });

const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });

const days = (ms: number) => {
  const d = Math.max(1, Math.round(ms / DAY_MS));
  return `${d} day${d === 1 ? "" : "s"}`;
};

type Version = OtaTimelineDto["versions"][number];

/** Past versions, then what's installed, then what's next, along one track. */
export function SoftwarePanel(props: { vehicleId: string }) {
  const { data: state, isPending: statePending } = useVehicleState(props.vehicleId);
  const { data: ota, isPending: otaPending } = useQuery({
    queryKey: ["ota", props.vehicleId],
    queryFn: () => api.otaTimeline(props.vehicleId),
    refetchInterval: 15 * 60_000,
  });
  // Day precision: the mount time is close enough.
  const [now] = useState(() => Date.now());
  const update = softwareUpdate(state);
  const failed = lastInstallFailed(state);

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

  return (
    <Panel
      title="Software"
      action={gap != null && <span className="text-xs text-[var(--text-muted)]">Updates every ~{days(gap * DAY_MS)}</span>}
    >
      {statePending || otaPending ? (
        <SkeletonBlock height="7rem" />
      ) : (
        <>
          <ol className="flex flex-col sm:flex-row">
            {hidden > 0 && (
              <Stop kind="past" grow={0.8}>
                <div className="text-sm text-[var(--text-muted)]">
                  {hidden} earlier
                </div>
                <div className="whitespace-nowrap text-xs text-[var(--text-muted)]">Since {shortDate(before[0]!.firstSeen)}</div>
              </Stop>
            )}
            {past.map((v, i) => (
              <Stop key={v.version} kind="past" grow={1}>
                <VersionName vehicleId={props.vehicleId} version={v} />
                <div className="text-xs text-[var(--text-muted)]">
                  {shortDate(v.firstSeen)} · {days(Date.parse((past[i + 1] ?? installed ?? v).firstSeen) - Date.parse(v.firstSeen))}
                </div>
              </Stop>
            ))}
            <Stop kind="installed" grow={2} next={update ? "update" : "none"} progress={trackFill(update)}>
              <Eyebrow color={update || failed ? "var(--text-muted)" : "var(--status-good)"}>
                {update || failed ? (
                  "Installed"
                ) : (
                  <>
                    <CheckIcon /> Up to date
                  </>
                )}
              </Eyebrow>
              <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{current ?? "—"}</div>
              <div className="mt-0.5 text-sm text-[var(--text-secondary)]">
                {installed
                  ? `${tracked ? "Seen since" : "Installed"} ${longDate(installed.firstSeen)} · ${days(now - Date.parse(installed.firstSeen))}`
                  : "Waiting for the vehicle to report its version"}
              </div>
              {current && <NotesLink vehicleId={props.vehicleId} version={current} />}
            </Stop>
            {update ? (
              <Stop kind="update" grow={2} active={update.phase === "downloading" || update.phase === "installing"}>
                <PendingDetails vehicleId={props.vehicleId} update={update} />
              </Stop>
            ) : (
              <Stop kind="none" grow={1.2}>
                <div className="text-sm text-[var(--text-muted)]">No update waiting</div>
                <div className="text-xs text-[var(--text-muted)]">New versions appear here when offered.</div>
              </Stop>
            )}
          </ol>
          {failed && (
            <p
              role="alert"
              className="mt-4 rounded-lg bg-[color-mix(in_srgb,var(--status-warning)_10%,transparent)] px-4 py-3 text-sm text-[var(--status-warning)]"
            >
              The vehicle reported that its last update didn’t install. Check the Rivian app for details.
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
  if (update.phase === "downloading" || update.phase === "installing") return update.progress;
  return 100;
}

type StopKind = "past" | "installed" | "update" | "none";

/**
 * One point on the track: a marker, the segment to the next point, and its
 * details. The track runs across on wide screens and down on phones.
 */
function Stop(props: {
  kind: StopKind;
  grow: number;
  /** For the installed stop: what follows it, which colors its segment. */
  next?: "update" | "none";
  progress?: number | null;
  active?: boolean;
  children: ReactNode;
}) {
  const last = props.kind === "update" || props.kind === "none";
  const toUpdate = props.next === "update";
  const fill = props.progress;

  return (
    <li className="relative min-w-0 pb-6 pl-7 last:pb-0 sm:pb-0 sm:pl-0 sm:pr-6 sm:pt-8 sm:last:pr-0" style={{ flexGrow: props.grow, flexBasis: 0 }}>
      {!last && (
        <span
          aria-hidden
          className={`absolute overflow-hidden rounded-full max-sm:bottom-0 max-sm:left-[5px] max-sm:top-5 max-sm:w-0.5 sm:left-5 sm:right-2 sm:top-[5px] sm:h-0.5 ${
            toUpdate ? "bg-[color-mix(in_srgb,var(--accent)_22%,transparent)]" : "bg-[var(--border)]"
          }`}
        >
          {toUpdate && (
            <span
              className={`absolute left-0 top-0 rounded-full bg-[var(--accent)] transition-all duration-700 max-sm:h-[var(--fill)] max-sm:w-full sm:h-full sm:w-[var(--fill)] ${
                fill == null ? "ota-progress--indeterminate" : ""
              }`}
              style={{ ["--fill" as string]: `${fill ?? 30}%` }}
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
  const base = "absolute left-0 top-0 block h-3 w-3 rounded-full";
  switch (props.kind) {
    case "past":
      return <span aria-hidden className={`${base} border-2 border-[var(--text-muted)] bg-[var(--surface-1)]`} />;
    case "installed":
      return (
        <span
          aria-hidden
          className={`${base} bg-[var(--status-good)] shadow-[0_0_0_4px_color-mix(in_srgb,var(--status-good)_18%,transparent)]`}
        />
      );
    case "update":
      return (
        <span
          aria-hidden
          className={`${base} bg-[var(--accent)] text-[var(--accent)] shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent)_18%,transparent)] ${
            props.active ? "chip-dot--pulse" : ""
          }`}
        />
      );
    case "none":
      return <span aria-hidden className={`${base} border-2 border-dashed border-[var(--text-muted)]`} />;
  }
}

function PendingDetails(props: { vehicleId: string; update: SoftwareUpdate }) {
  const { update } = props;
  const facts = [
    update.type && `${update.type} update`,
    update.installMinutes != null && `${installTimeLabel(update.installMinutes)} to install`,
  ].filter(Boolean);
  const hint =
    update.phase === "ready"
      ? "Start or schedule the install from the touchscreen or the Rivian app."
      : update.phase === "installing"
        ? "The vehicle can’t be driven until the install finishes."
        : null;

  return (
    <>
      <Eyebrow color="var(--accent)">{update.label}</Eyebrow>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{update.version ?? "New version"}</div>
      {facts.length > 0 && <div className="mt-0.5 text-sm text-[var(--text-secondary)]">{facts.join(" · ")}</div>}
      {hint && <div className="mt-1 text-xs text-[var(--text-muted)]">{hint}</div>}
      {update.version && <NotesLink vehicleId={props.vehicleId} version={update.version} />}
    </>
  );
}

function Eyebrow(props: { color: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide" style={{ color: props.color }}>
      {props.children}
    </div>
  );
}

/** A past version's number, linking to its notes when they were saved. */
function VersionName(props: { vehicleId: string; version: Version }) {
  const { version } = props.version;
  if (!props.version.hasNotes) return <div className="flex text-sm tabular-nums text-[var(--text-secondary)]">{version}</div>;
  return (
    <a
      href={releaseNotesHref(props.vehicleId, version)}
      target="_blank"
      rel="noreferrer noopener"
      title="Release notes"
      className="flex w-fit items-center gap-1 text-sm tabular-nums text-[var(--text-secondary)] underline-offset-4 hover:text-[var(--text-primary)] hover:underline"
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
      className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--text-secondary)] underline-offset-4 transition-colors hover:text-[var(--text-primary)] hover:underline"
    >
      Release notes
      <ArrowIcon />
    </a>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M4.5 2.5h5v5M9.5 2.5l-7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
      <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

