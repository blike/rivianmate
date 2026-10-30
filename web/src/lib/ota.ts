import type { OtaInstallDto, OtaPendingDto, VehicleState } from '@server/api-types';
import { nv, sv, titleCase } from './state';

export type OtaPhase =
  'available' | 'waiting' | 'downloading' | 'preparing' | 'ready' | 'installing';

export interface SoftwareUpdate {
  /** Pending version; null if the vehicle stops reporting it mid-install. */
  version: string | null;
  phase: OtaPhase;
  /** 0–100 while downloading or installing. */
  progress: number | null;
  /** The vehicle's install-time estimate. */
  installMinutes: number | null;
  /** Rivian's category for the update, e.g. "Convenience". */
  type: string | null;
  label: string;
}

const NO_VERSION = new Set(['', '0.0.0']);

const PHASE_LABEL: Record<OtaPhase, string> = {
  available: 'Update available',
  waiting: 'Waiting for connection',
  downloading: 'Downloading',
  preparing: 'Preparing',
  ready: 'Ready to install',
  installing: 'Installing',
};

/**
 * otaStatus values seen through one update, in order: Idle,
 * Ready_To_Download, Connection_Lost (hours, while driving), Downloading,
 * Preparing, Ready_To_Install, Install_Countdown (two minutes),
 * Awaiting_Install (install tapped), Installing. A failed download or
 * install leaves the update waiting, and lastInstallFailed says so.
 */
const STATUS_PHASE: Record<string, OtaPhase> = {
  ready_to_download: 'available',
  connection_lost: 'waiting',
  downloading: 'downloading',
  download_failed: 'available',
  preparing: 'preparing',
  ready_to_install: 'ready',
  scheduled_to_install: 'ready',
  install_countdown: 'installing',
  awaiting_install: 'installing',
  installing: 'installing',
  install_failed: 'available',
};

/** Statuses worded apart from their phase, while no progress is reported. */
const STATUS_LABEL: Record<string, string> = {
  scheduled_to_install: 'Install scheduled',
  install_countdown: 'Starting install',
  awaiting_install: 'Starting install',
};

const FAILED = new Set(['download_failed', 'install_failed']);

/** Phases where the vehicle is working on the update, with or without a version. */
const ACTIVE: ReadonlySet<OtaPhase> = new Set(['downloading', 'preparing', 'installing']);

export function isActivePhase(phase: OtaPhase): boolean {
  return ACTIVE.has(phase);
}

const inProgress = (n: number | null): n is number => n != null && n > 0 && n < 100;

/**
 * Whether the vehicle says when an update is offered; both feeds do. Until
 * one has, no update pending can't be told from one the app can't see.
 */
export function reportsUpdates(state: VehicleState | undefined): boolean {
  return state != null && ('otaAvailableVersion' in state || 'otaStatus' in state);
}

/**
 * A software update that's pending or under way, if any. Progress
 * percentages and the vehicle's ota_update power state win over the status,
 * except a lost connection or a failure: a paused or failed download keeps
 * reporting its last percentage. Unknown statuses fall back to matching
 * words in them.
 */
export function softwareUpdate(state: VehicleState | undefined): SoftwareUpdate | null {
  const current = sv(state, 'otaCurrentVersion');
  const availableRaw = sv(state, 'otaAvailableVersion');
  const status = (sv(state, 'otaStatus') ?? '').toLowerCase();
  // Once the pending version is installed, the vehicle keeps reporting the
  // install's last status and progress (observed: Installing, 99%). It names
  // the new version a couple of minutes before the install ends, though, so
  // it's installing for as long as its power state says so.
  const done = (current && availableRaw === current) || status === 'install_success';
  if (done && sv(state, 'powerState') !== 'ota_update') return null;
  const available = availableRaw && !NO_VERSION.has(availableRaw) ? availableRaw : null;
  const download = nv(state, 'otaDownloadProgress');
  const install = nv(state, 'otaInstallProgress');

  const failed = FAILED.has(status);

  let phase: OtaPhase | null = null;
  let progress: number | null = null;
  if (!failed && (inProgress(install) || sv(state, 'powerState') === 'ota_update')) {
    phase = 'installing';
  } else if (!failed && inProgress(download) && status !== 'connection_lost') {
    phase = 'downloading';
  } else if (status in STATUS_PHASE) {
    phase = STATUS_PHASE[status]!;
  } else if (status.includes('install') && !status.includes('ready')) {
    phase = 'installing';
  } else if (status.includes('download')) {
    phase = 'downloading';
  } else if (available) {
    phase = status.includes('ready') ? 'ready' : 'available';
  }
  // A waiting or ready status with nothing pending is left over from the last update.
  if (!phase || (!available && !ACTIVE.has(phase))) return null;
  if (phase === 'installing' && inProgress(install)) progress = install;
  if ((phase === 'downloading' || phase === 'waiting') && inProgress(download)) progress = download;

  const label = (progress == null && STATUS_LABEL[status]) || PHASE_LABEL[phase];
  const duration = nv(state, 'otaInstallDuration');
  const type = sv(state, 'otaInstallType');
  return {
    version: available,
    phase,
    progress,
    installMinutes: duration != null && duration > 0 ? duration : null,
    type: type ? titleCase(type) : null,
    label: label + (progress != null ? ` · ${Math.round(progress)}%` : ''),
  };
}

/** True when the vehicle reports the last install, or the pending download, didn't succeed. */
export function lastInstallFailed(state: VehicleState | undefined): boolean {
  return (
    /fail|error/i.test(sv(state, 'otaCurrentStatus') ?? '') ||
    FAILED.has((sv(state, 'otaStatus') ?? '').toLowerCase())
  );
}

/** 65 → "1 hr 5 min"; two days or more → "3 days". */
export function durationLabel(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 1) return 'under a minute';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h >= 48) return `${Math.round(h / 24)} days`;
  return `${h} hr${m % 60 ? ` ${m % 60} min` : ''}`;
}

/** Minutes in the current status, if the history's status is still the live one. */
export function phaseMinutes(
  pending: OtaPendingDto | null | undefined,
  state: VehicleState | undefined,
  now: number,
): number | null {
  if (!pending?.since || pending.status !== sv(state, 'otaStatus')) return null;
  return Math.max(0, (now - Date.parse(pending.since)) / 60_000);
}

/** Minutes until the download finishes, at its pace since this stretch began. */
export function downloadMinutesLeft(
  pending: OtaPendingDto | null | undefined,
  state: VehicleState | undefined,
  now: number,
): number | null {
  const elapsed = phaseMinutes(pending, state, now);
  const progress = nv(state, 'otaDownloadProgress');
  if (pending?.status !== 'Downloading' || elapsed == null || elapsed < 1 || progress == null)
    return null;
  const gained = progress - (pending.progressAtStart ?? 0);
  if (gained < 2 || progress >= 100) return null;
  return ((100 - progress) * elapsed) / gained;
}

/** Phases that come after the download has finished. */
const DOWNLOADED: ReadonlySet<OtaPhase> = new Set(['preparing', 'ready', 'installing']);

/**
 * The pending update's details: time in an active phase (or the download's
 * time left), how long the download took, the install estimate and type.
 */
export function pendingFacts(
  update: SoftwareUpdate,
  pending: OtaPendingDto | null | undefined,
  state: VehicleState | undefined,
  now: number,
): string[] {
  const facts: string[] = [];
  if (update.phase === 'waiting' || isActivePhase(update.phase)) {
    const left = downloadMinutesLeft(pending, state, now);
    const elapsed = phaseMinutes(pending, state, now);
    if (left != null) facts.push(`About ${durationLabel(left)} left`);
    else if (elapsed != null) facts.push(`Started ${durationLabel(elapsed)} ago`);
  }
  const thisUpdate = pending && pending.version === update.version ? pending : null;
  if (thisUpdate?.downloadMinutes != null && DOWNLOADED.has(update.phase))
    facts.push(`Downloaded in ${durationLabel(thisUpdate.downloadMinutes)}`);
  if (update.installMinutes != null)
    facts.push(`${durationLabel(update.installMinutes)} estimated install`);
  if (update.type) facts.push(`${update.type} update`);
  return facts;
}

/** "Downloaded in 15 min · Installed in 33 min (estimated 1 hr 5 min)". */
export function installRecap(install: OtaInstallDto): string | null {
  const parts = [
    install.downloadMinutes != null && `downloaded in ${durationLabel(install.downloadMinutes)}`,
    install.installMinutes != null &&
      `Installed in ${durationLabel(install.installMinutes)}` +
        (install.estimatedMinutes != null
          ? ` (estimated ${durationLabel(install.estimatedMinutes)})`
          : ''),
  ].filter((p): p is string => typeof p === 'string');
  if (parts.length === 0) return null;
  const text = parts.join(' · ');
  return text[0]!.toUpperCase() + text.slice(1);
}

/** Server route serving the saved copy of Rivian's release notes. */
export function releaseNotesHref(vehicleId: string, version: string): string {
  return `/api/vehicles/${encodeURIComponent(vehicleId)}/ota/notes/${encodeURIComponent(version)}`;
}

const DAY_MS = 86_400_000;

/**
 * Median days between updates, from versions newest first. The oldest
 * version's date is when tracking began, not an install, so it's left out.
 */
export function typicalUpdateGapDays(versions: readonly { firstSeen: string }[]): number | null {
  const installs = versions.slice(0, -1).map((v) => Date.parse(v.firstSeen));
  const gaps: number[] = [];
  for (let i = 0; i < installs.length - 1; i++)
    gaps.push((installs[i]! - installs[i + 1]!) / DAY_MS);
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  const mid = gaps.length / 2;
  return gaps.length % 2 ? gaps[Math.floor(mid)]! : (gaps[mid - 1]! + gaps[mid]!) / 2;
}
