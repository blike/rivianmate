import type { VehicleState } from '@server/api-types';
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
 * Preparing, Ready_To_Install, Awaiting_Install (install tapped), Installing.
 */
const STATUS_PHASE: Record<string, OtaPhase> = {
  ready_to_download: 'available',
  connection_lost: 'waiting',
  downloading: 'downloading',
  preparing: 'preparing',
  ready_to_install: 'ready',
  awaiting_install: 'installing',
  installing: 'installing',
};

/** Phases where the vehicle is working on the update, with or without a version. */
const ACTIVE: ReadonlySet<OtaPhase> = new Set(['downloading', 'preparing', 'installing']);

export function isActivePhase(phase: OtaPhase): boolean {
  return ACTIVE.has(phase);
}

const inProgress = (n: number | null): n is number => n != null && n > 0 && n < 100;

/**
 * A software update that's pending or under way, if any. Progress
 * percentages and the vehicle's ota_update power state win over the status,
 * and unknown statuses fall back to matching words in them.
 */
export function softwareUpdate(state: VehicleState | undefined): SoftwareUpdate | null {
  const current = sv(state, 'otaCurrentVersion');
  const availableRaw = sv(state, 'otaAvailableVersion');
  // Once the pending version is installed, the vehicle keeps reporting the
  // install's last status and progress (observed: Installing, 99%).
  if (current && availableRaw === current) return null;
  const available = availableRaw && !NO_VERSION.has(availableRaw) ? availableRaw : null;
  const status = (sv(state, 'otaStatus') ?? '').toLowerCase();
  const download = nv(state, 'otaDownloadProgress');
  const install = nv(state, 'otaInstallProgress');

  let phase: OtaPhase | null = null;
  let progress: number | null = null;
  if (inProgress(install) || sv(state, 'powerState') === 'ota_update') {
    phase = 'installing';
  } else if (inProgress(download)) {
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
  if (phase === 'downloading' && inProgress(download)) progress = download;

  const label =
    status === 'awaiting_install' && progress == null ? 'Starting install' : PHASE_LABEL[phase];
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

/** True when the vehicle reports the last install didn't succeed. */
export function lastInstallFailed(state: VehicleState | undefined): boolean {
  return /fail|error/i.test(sv(state, 'otaCurrentStatus') ?? '');
}

/** "65 min" → "About 1 hr 5 min". */
export function installTimeLabel(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `About ${m} min`;
  const h = Math.floor(m / 60);
  return `About ${h} hr${m % 60 ? ` ${m % 60} min` : ''}`;
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
