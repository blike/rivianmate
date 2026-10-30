import { describe, expect, it } from 'vitest';
import { otaHistory } from './ota-history.js';
import type { StateChange } from './state-history.js';

const t = (hhmm: string, day = 8) =>
  Date.parse(`2026-10-${String(day).padStart(2, '0')}T${hhmm}:00Z`);
const c = (at: number, field: string, value: string | number): StateChange => ({
  field,
  at,
  value,
});

/** 2026.36.0 as recorded: offered, a stalled start, downloaded, installed days later. */
const update: StateChange[] = [
  c(t('09:00', 1), 'otaCurrentVersion', '2026.31.0'),
  c(t('09:00', 1), 'otaAvailableVersion', '0.0.0'),
  c(t('09:00', 1), 'otaStatus', 'Idle'),
  c(t('19:11'), 'otaAvailableVersion', '2026.36.0'),
  c(t('19:11'), 'otaStatus', 'Connection_Lost'),
  c(t('21:34'), 'otaDownloadProgress', 0),
  c(t('21:34'), 'otaStatus', 'Downloading'),
  c(t('21:40'), 'otaDownloadProgress', 40),
  c(t('21:49'), 'otaStatus', 'Preparing'),
  c(t('22:06'), 'otaStatus', 'Ready_To_Install'),
  c(t('04:16', 10), 'otaInstallDuration', 65),
  c(t('04:26', 12), 'otaStatus', 'Install_Countdown'),
  c(t('04:29', 12), 'otaStatus', 'Installing'),
  c(t('05:02', 12), 'otaCurrentVersion', '2026.36.0'),
  c(t('05:02', 12), 'otaInstallDuration', 0),
  c(t('05:02', 12), 'otaStatus', 'Idle'),
  c(t('05:02', 12), 'otaAvailableVersion', '0.0.0'),
];

describe('otaHistory', () => {
  it('summarizes the last completed update', () => {
    expect(otaHistory(update)).toEqual({
      pending: null,
      lastInstall: {
        version: '2026.36.0',
        installedAt: new Date(t('05:02', 12)).toISOString(),
        downloadMinutes: 15,
        installMinutes: 33,
        estimatedMinutes: 65,
      },
    });
  });

  it('times an install to its end, not to when the new version is named', () => {
    // As 2026.36.01 did: named at 02:43, finished at 02:45.
    const { lastInstall } = otaHistory([
      ...update,
      c(t('21:38', 29), 'otaAvailableVersion', '2026.36.01'),
      c(t('02:20', 30), 'otaStatus', 'Installing'),
      c(t('02:43', 30), 'otaCurrentVersion', '2026.36.01'),
      c(t('02:45', 30), 'otaStatus', 'Install_Success'),
      c(t('02:46', 30), 'otaStatus', 'Idle'),
    ]);
    expect(lastInstall).toMatchObject({ version: '2026.36.01', installMinutes: 25 });
  });

  it('describes the pending update and when it entered its status', () => {
    const next = [
      ...update,
      c(t('21:38', 29), 'otaAvailableVersion', '2026.36.01'),
      c(t('21:38', 29), 'otaStatus', 'Connection_Lost'),
      c(t('23:09', 29), 'otaStatus', 'Downloading'),
      c(t('23:14', 29), 'otaDownloadProgress', 11),
      c(t('23:19', 29), 'otaStatus', 'Connection_Lost'),
      c(t('00:44', 30), 'otaStatus', 'Downloading'),
      c(t('00:50', 30), 'otaDownloadProgress', 60),
    ];
    const { pending, lastInstall } = otaHistory(next);
    expect(pending).toEqual({
      version: '2026.36.01',
      offeredAt: new Date(t('21:38', 29)).toISOString(),
      // The finished stretch only; the one under way isn't counted yet.
      downloadMinutes: 10,
      status: 'Downloading',
      since: new Date(t('00:44', 30)).toISOString(),
      progressAtStart: 11,
    });
    expect(lastInstall?.version).toBe('2026.36.0');
  });

  it('leaves out what it never saw', () => {
    // Tracking began mid-update: no download or install time, no estimate.
    const { lastInstall } = otaHistory([
      c(t('10:00'), 'otaCurrentVersion', '2026.31.0'),
      c(t('10:00'), 'otaAvailableVersion', '2026.36.0'),
      c(t('10:00'), 'otaStatus', 'Ready_To_Install'),
      c(t('11:00'), 'otaCurrentVersion', '2026.36.0'),
    ]);
    expect(lastInstall).toMatchObject({
      downloadMinutes: null,
      installMinutes: null,
      estimatedMinutes: null,
    });
  });
});
