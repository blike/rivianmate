import type { OtaInstallDto, OtaPendingDto } from '../api-types.js';
import type { StateChange } from './state-history.js';

const NO_VERSION = new Set(['', '0.0.0']);
const MINUTE_MS = 60_000;

/** State fields otaHistory reads. */
export const OTA_HISTORY_FIELDS = [
  'otaCurrentVersion',
  'otaAvailableVersion',
  'otaStatus',
  'otaDownloadProgress',
  'otaInstallDuration',
] as const;

interface Cycle {
  version: string;
  offeredAt: number;
  downloadMs: number;
  installingAt: number | null;
  estimate: number | null;
}

const minutes = (ms: number) => (ms > 0 ? ms / MINUTE_MS : null);

/**
 * Walks OTA state changes (in time order) for the update under way and how
 * the last completed one went. An update runs from its version being offered
 * until it's the installed one.
 */
export function otaHistory(changes: readonly StateChange[]): {
  pending: OtaPendingDto | null;
  lastInstall: OtaInstallDto | null;
} {
  let cycle = null as Cycle | null;
  let current: string | null = null;
  let status: string | null = null;
  let statusAt = 0;
  let progress: number | null = null;
  let progressAtStatus: number | null = null;
  let lastInstall: OtaInstallDto | null = null;
  // When the last install began, until it's seen to finish.
  let finishing: number | null = null;

  for (const { field, at, value } of changes) {
    const text = value == null ? '' : String(value);
    if (field === 'otaAvailableVersion') {
      if (!NO_VERSION.has(text) && text !== current && cycle?.version !== text) {
        cycle = { version: text, offeredAt: at, downloadMs: 0, installingAt: null, estimate: null };
        finishing = null;
      }
    } else if (field === 'otaStatus') {
      if (cycle && status === 'Downloading') cycle.downloadMs += at - statusAt;
      if (cycle && text === 'Installing') cycle.installingAt ??= at;
      // The new version is named a couple of minutes before the install ends.
      if (lastInstall && finishing != null && (text === 'Install_Success' || text === 'Idle')) {
        lastInstall.installMinutes = (at - finishing) / MINUTE_MS;
        finishing = null;
      }
      status = text;
      statusAt = at;
      progressAtStatus = progress;
    } else if (field === 'otaDownloadProgress') {
      progress = typeof value === 'number' ? value : null;
    } else if (field === 'otaInstallDuration') {
      if (cycle && typeof value === 'number' && value > 0) cycle.estimate = value;
    } else if (field === 'otaCurrentVersion') {
      current = text;
      if (cycle?.version === text) {
        if (status === 'Downloading') cycle.downloadMs += at - statusAt;
        lastInstall = {
          version: text,
          installedAt: new Date(at).toISOString(),
          downloadMinutes: minutes(cycle.downloadMs),
          installMinutes: cycle.installingAt != null ? (at - cycle.installingAt) / MINUTE_MS : null,
          estimatedMinutes: cycle.estimate,
        };
        finishing = cycle.installingAt;
        cycle = null;
      }
    }
  }

  const pending = cycle && {
    version: cycle.version,
    offeredAt: new Date(cycle.offeredAt).toISOString(),
    downloadMinutes: minutes(cycle.downloadMs),
    status,
    since: status ? new Date(statusAt).toISOString() : null,
    progressAtStart: progressAtStatus,
  };
  return { pending, lastInstall };
}
