import type { OtaTimelineDto } from "@server/api-types.js";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client.js";
import { useVehicleState } from "../api/hooks.js";
import {
  type SoftwareUpdate,
  installTimeLabel,
  lastInstallFailed,
  releaseNotesHref,
  softwareUpdate,
} from "../lib/ota.js";
import { Panel } from "./panels.js";
import { SkeletonRows } from "./loading.js";

const DAY_MS = 86_400_000;

const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });

const days = (ms: number) => {
  const d = Math.max(1, Math.round(ms / DAY_MS));
  return `${d} day${d === 1 ? "" : "s"}`;
};

export function SoftwarePanel(props: { vehicleId: string }) {
  const { data: state, isPending: statePending } = useVehicleState(props.vehicleId);
  const { data: ota, isPending: otaPending } = useQuery({
    queryKey: ["ota", props.vehicleId],
    queryFn: () => api.otaTimeline(props.vehicleId),
    refetchInterval: 15 * 60_000,
  });
  const update = softwareUpdate(state);
  const current = ota?.current ?? null;

  return (
    <Panel title="Software">
      {statePending || otaPending ? (
        <SkeletonRows rows={3} />
      ) : (
        <div className="space-y-5">
          {update ? (
            <PendingUpdate vehicleId={props.vehicleId} update={update} current={current} />
          ) : (
            current && <UpToDate vehicleId={props.vehicleId} version={current} />
          )}
          {lastInstallFailed(state) && (
            <p role="alert" className="text-sm text-[var(--status-warning)]">
              The vehicle reported that its last update didn’t install. Check the Rivian app for details.
            </p>
          )}
          <History vehicleId={props.vehicleId} ota={ota} />
        </div>
      )}
    </Panel>
  );
}

function PendingUpdate(props: { vehicleId: string; update: SoftwareUpdate; current: string | null }) {
  const { update } = props;
  const active = update.phase === "downloading" || update.phase === "installing";
  const facts = [
    update.type && `${update.type} update`,
    update.installMinutes != null && `${installTimeLabel(update.installMinutes)} to install`,
    props.current && `Replaces ${props.current}`,
  ].filter(Boolean);

  return (
    <div className="ota-pending rounded-lg p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-[var(--accent)]">
            <span
              className={`h-1.5 w-1.5 rounded-full bg-[var(--accent)] text-[var(--accent)] ${active ? "chip-dot--pulse" : ""}`}
            />
            {update.label}
          </div>
          {update.version && (
            <div className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight">{update.version}</div>
          )}
          {facts.length > 0 && (
            <p className="mt-1 text-sm text-[var(--text-secondary)]">{facts.join(" · ")}</p>
          )}
        </div>
        {update.version && <NotesLink vehicleId={props.vehicleId} version={update.version} />}
      </div>

      {active && (
        <div
          className="mt-4 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]"
          role="progressbar"
          aria-label={update.label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={update.progress ?? undefined}
        >
          <div
            className={`h-full rounded-full bg-[var(--accent)] transition-[width] duration-700 ${update.progress == null ? "ota-progress--indeterminate" : ""}`}
            style={{ width: update.progress == null ? "30%" : `${update.progress}%` }}
          />
        </div>
      )}

      {update.phase === "ready" && (
        <p className="mt-3 text-xs text-[var(--text-muted)]">
          Downloaded to the vehicle. Start or schedule the install from the touchscreen or the Rivian app.
        </p>
      )}
      {update.phase === "installing" && (
        <p className="mt-3 text-xs text-[var(--text-muted)]">The vehicle can’t be driven until the install finishes.</p>
      )}
    </div>
  );
}

function UpToDate(props: { vehicleId: string; version: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="grid h-8 w-8 place-items-center rounded-full bg-[color-mix(in_srgb,var(--status-good)_16%,transparent)] text-[var(--status-good)]"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <div>
          <div className="text-sm font-medium">Up to date</div>
          <div className="text-xs tabular-nums text-[var(--text-muted)]">{props.version}</div>
        </div>
      </div>
      <NotesLink vehicleId={props.vehicleId} version={props.version} />
    </div>
  );
}

function History(props: { vehicleId: string; ota: OtaTimelineDto | undefined }) {
  const versions = props.ota?.versions ?? [];
  if (versions.length === 0) {
    return <p className="py-4 text-center text-sm text-[var(--text-muted)]">No software versions recorded yet.</p>;
  }
  return (
    <div>
      <h4 className="mb-2 text-xs uppercase tracking-wide text-[var(--text-muted)]">Installed versions</h4>
      <ol className="relative">
        {versions.map((v, i) => {
          const installed = i === 0 && v.version === props.ota?.current;
          const until = i > 0 ? versions[i - 1]?.firstSeen : undefined;
          const span = until
            ? `${longDate(v.firstSeen)} – ${longDate(until)} · ${days(Date.parse(until) - Date.parse(v.firstSeen))}`
            : `Since ${longDate(v.firstSeen)}`;
          return (
            <li key={v.version} className="relative flex gap-3 pb-4 last:pb-0">
              {i < versions.length - 1 && (
                <span aria-hidden className="absolute left-[4.5px] top-3 bottom-0 w-px bg-[var(--border)]" />
              )}
              <span
                aria-hidden
                className={`relative mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border-2 ${
                  installed ? "border-[var(--status-good)] bg-[var(--status-good)]" : "border-[var(--border)] bg-[var(--surface-1)]"
                }`}
              />
              <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <div className="min-w-0">
                  <span className={`text-sm tabular-nums ${installed ? "font-medium" : "text-[var(--text-secondary)]"}`}>
                    {v.version}
                  </span>
                  {installed && <span className="ml-2 text-xs text-[var(--status-good)]">Installed</span>}
                  <div className="text-xs text-[var(--text-muted)]">{span}</div>
                </div>
                {(installed || v.hasNotes) && <NotesLink vehicleId={props.vehicleId} version={v.version} />}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-xs text-[var(--text-muted)]">
        Dates are when RivianMate first saw each version. Release notes are saved from then on, so older versions may not have them.
      </p>
    </div>
  );
}

function NotesLink(props: { vehicleId: string; version: string }) {
  return (
    <a
      href={releaseNotesHref(props.vehicleId, props.version)}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--text-muted)] hover:text-[var(--text-primary)]"
    >
      Release notes
      <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
        <path d="M4.5 2.5h5v5M9.5 2.5l-7 7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </a>
  );
}
