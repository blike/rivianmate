import type { VehicleState } from '@server/api-types';
import { describe, expect, it } from 'vitest';
import {
  downloadMinutesLeft,
  durationLabel,
  installRecap,
  lastInstallFailed,
  pendingFacts,
  phaseMinutes,
  reportsUpdates,
  softwareUpdate,
  typicalUpdateGapDays,
} from './ota';

const v = (value: string | number) => ({ timeStamp: 't', value });
const state = (fields: Record<string, string | number>) =>
  Object.fromEntries(Object.entries(fields).map(([k, x]) => [k, v(x)])) as unknown as VehicleState;

const base = { otaCurrentVersion: '2026.31.0', otaAvailableVersion: '2026.36.0' };

describe('reportsUpdates', () => {
  it('is true only for a vehicle that says when an update is offered', () => {
    expect(reportsUpdates(state(base))).toBe(true);
    expect(reportsUpdates(state({ otaCurrentVersion: '2026.31.0', otaStatus: 'Idle' }))).toBe(true);
    // As an R2: Parallax sends only the installed version.
    expect(reportsUpdates(state({ otaCurrentVersion: '2026.31.0' }))).toBe(false);
    expect(reportsUpdates(undefined)).toBe(false);
  });
});

describe('softwareUpdate', () => {
  it('is null when up to date', () => {
    expect(
      softwareUpdate(
        state({ otaCurrentVersion: '2026.31.0', otaAvailableVersion: '0.0.0', otaStatus: 'Idle' }),
      ),
    ).toBeNull();
    expect(
      softwareUpdate(state({ otaCurrentVersion: '2026.31.0', otaAvailableVersion: '2026.31.0' })),
    ).toBeNull();
    expect(softwareUpdate(undefined)).toBeNull();
  });

  it('reads a downloaded update as ready, with its details', () => {
    expect(
      softwareUpdate(
        state({
          ...base,
          otaStatus: 'Ready_To_Install',
          otaInstallDuration: 65,
          otaInstallType: 'Convenience',
          otaDownloadProgress: 0,
        }),
      ),
    ).toEqual({
      version: '2026.36.0',
      phase: 'ready',
      progress: null,
      installMinutes: 65,
      type: 'Convenience',
      label: 'Ready to install',
    });
  });

  it('shows download and install progress', () => {
    expect(
      softwareUpdate(state({ ...base, otaStatus: 'Idle', otaDownloadProgress: 42 })),
    ).toMatchObject({
      phase: 'downloading',
      label: 'Downloading · 42%',
    });
    expect(
      softwareUpdate(state({ ...base, otaStatus: 'Installing', otaInstallProgress: 37.6 })),
    ).toMatchObject({
      phase: 'installing',
      label: 'Installing · 38%',
    });
    expect(softwareUpdate(state({ ...base, otaStatus: 'Idle' }))).toMatchObject({
      phase: 'available',
      label: 'Update available',
    });
  });

  it('follows the statuses seen through a real update', () => {
    const at = (otaStatus: string, extra: Record<string, string | number> = {}) =>
      softwareUpdate(state({ ...base, otaStatus, ...extra }));
    expect(at('Ready_To_Download')).toMatchObject({ phase: 'available' });
    expect(at('Connection_Lost')).toMatchObject({
      phase: 'waiting',
      label: 'Waiting for connection',
    });
    // A paused download keeps reporting its last percentage.
    expect(at('Connection_Lost', { otaDownloadProgress: 12 })).toMatchObject({
      phase: 'waiting',
      progress: 12,
      label: 'Waiting for connection · 12%',
    });
    expect(at('Downloading')).toMatchObject({ phase: 'downloading', progress: null });
    expect(at('Preparing')).toMatchObject({ phase: 'preparing', label: 'Preparing' });
    expect(at('Ready_To_Install')).toMatchObject({ phase: 'ready' });
    expect(at('Install_Countdown')).toMatchObject({
      phase: 'installing',
      label: 'Starting install',
    });
    expect(at('Awaiting_Install')).toMatchObject({
      phase: 'installing',
      label: 'Starting install',
    });
    expect(at('Ready_To_Install', { powerState: 'ota_update' })).toMatchObject({
      phase: 'installing',
    });
    expect(at('Installing', { otaInstallProgress: 0 })).toMatchObject({
      phase: 'installing',
      label: 'Installing',
    });
  });

  it('words a scheduled install and leaves a failed update waiting', () => {
    const at = (otaStatus: string, extra: Record<string, string | number> = {}) =>
      softwareUpdate(state({ ...base, otaStatus, ...extra }));
    expect(at('Scheduled_To_Install')).toMatchObject({
      phase: 'ready',
      label: 'Install scheduled',
    });
    // Neither a failed download's last percentage nor a failed install reads as progress.
    expect(at('Download_Failed', { otaDownloadProgress: 40 })).toMatchObject({
      phase: 'available',
      progress: null,
      label: 'Update available',
    });
    expect(at('Install_Failed', { otaInstallProgress: 60 })).toMatchObject({
      phase: 'available',
      progress: null,
    });
  });

  it('ignores a leftover status once nothing is pending', () => {
    const done = { otaCurrentVersion: '2026.36.0', otaAvailableVersion: '0.0.0' };
    expect(softwareUpdate(state({ ...done, otaStatus: 'Ready_To_Download' }))).toBeNull();
    expect(softwareUpdate(state({ ...done, otaStatus: 'Connection_Lost' }))).toBeNull();
    expect(softwareUpdate(state({ ...done, otaStatus: 'Install_Success' }))).toBeNull();
  });

  it('is done once the pending version is installed, despite a leftover status', () => {
    expect(
      softwareUpdate(
        state({
          otaCurrentVersion: '2026.36.0',
          otaAvailableVersion: '2026.36.0',
          otaStatus: 'Installing',
          otaInstallProgress: 99,
          powerState: 'sleep',
        }),
      ),
    ).toBeNull();
  });

  it('is still installing while the new version is named early', () => {
    // As 2026.36.01 did: the version switched two minutes before the install ended.
    expect(
      softwareUpdate(
        state({
          otaCurrentVersion: '2026.36.01',
          otaAvailableVersion: '2026.36.01',
          otaStatus: 'Installing',
          otaInstallProgress: 95,
          powerState: 'ota_update',
        }),
      ),
    ).toMatchObject({ phase: 'installing', version: '2026.36.01', label: 'Installing · 95%' });
  });

  it('keeps showing an install when the pending version drops out', () => {
    expect(
      softwareUpdate(
        state({
          otaCurrentVersion: '2026.31.0',
          otaAvailableVersion: '0.0.0',
          otaInstallProgress: 10,
        }),
      ),
    ).toMatchObject({ phase: 'installing', version: null });
  });
});

describe('lastInstallFailed', () => {
  it('flags failures only', () => {
    expect(lastInstallFailed(state({ otaCurrentStatus: 'Install_Success' }))).toBe(false);
    expect(lastInstallFailed(state({ otaCurrentStatus: 'Install_Failed' }))).toBe(true);
    expect(lastInstallFailed(state({ ...base, otaStatus: 'Download_Failed' }))).toBe(true);
    expect(lastInstallFailed(state({ ...base, otaStatus: 'Install_Failed' }))).toBe(true);
    expect(lastInstallFailed(state({ ...base, otaStatus: 'Installing' }))).toBe(false);
  });
});

describe('typicalUpdateGapDays', () => {
  const seen = (...days: number[]) =>
    days.map((d) => ({ firstSeen: new Date(Date.UTC(2026, 0, d)).toISOString() }));

  it('needs two installs after tracking began', () => {
    expect(typicalUpdateGapDays(seen(20, 1))).toBeNull();
    expect(typicalUpdateGapDays(seen(30, 10, 1))).toBe(20);
  });

  it('takes the median gap', () => {
    expect(typicalUpdateGapDays(seen(60, 40, 30, 2, 1))).toBe(20);
  });
});

describe('durationLabel', () => {
  it('scales from minutes to days', () => {
    expect(durationLabel(0.2)).toBe('under a minute');
    expect(durationLabel(33)).toBe('33 min');
    expect(durationLabel(85)).toBe('1 hr 25 min');
    expect(durationLabel(79 * 60)).toBe('3 days');
  });
});

describe('phase timing', () => {
  const since = Date.parse('2026-10-30T00:44:00Z');
  const phase = {
    version: '2026.36.0',
    offeredAt: '2026-10-29T21:38:00Z',
    downloadMinutes: 10,
    status: 'Downloading',
    since: new Date(since).toISOString(),
    progressAtStart: 12,
  };
  const at = (min: number) => since + min * 60_000;
  const downloading = (progress: number) =>
    state({ ...base, otaStatus: 'Downloading', otaDownloadProgress: progress });

  it('times the live status only', () => {
    expect(phaseMinutes(phase, downloading(30), at(6))).toBe(6);
    expect(phaseMinutes(phase, state({ ...base, otaStatus: 'Preparing' }), at(6))).toBeNull();
    expect(phaseMinutes(null, downloading(30), at(6))).toBeNull();
  });

  it("estimates the download's time left from this stretch's pace", () => {
    // 12% → 56% in 4 min: 11%/min, so 44% takes 4 min more.
    expect(downloadMinutesLeft(phase, downloading(56), at(4))).toBe(4);
    // Too early or too little progress to tell.
    expect(downloadMinutesLeft(phase, downloading(56), at(0.5))).toBeNull();
    expect(downloadMinutesLeft(phase, downloading(13), at(4))).toBeNull();
    expect(
      downloadMinutesLeft({ ...phase, status: 'Preparing' }, downloading(56), at(4)),
    ).toBeNull();
  });

  it('lists the pending update’s facts for its phase', () => {
    const ready = state({
      ...base,
      otaStatus: 'Ready_To_Install',
      otaInstallDuration: 65,
      otaInstallType: 'Convenience',
    });
    const pending = { ...phase, status: 'Ready_To_Install', downloadMinutes: 19 };
    // Ready isn't timed; the finished download is.
    expect(pendingFacts(softwareUpdate(ready)!, pending, ready, at(30))).toEqual([
      'Downloaded in 19 min',
      '1 hr 5 min estimated install',
      'Convenience update',
    ]);
    const live = downloading(56);
    expect(pendingFacts(softwareUpdate(live)!, phase, live, at(4))).toEqual(['About 4 min left']);
    const preparing = state({ ...base, otaStatus: 'Preparing' });
    expect(
      pendingFacts(softwareUpdate(preparing)!, { ...phase, status: 'Preparing' }, preparing, at(6)),
    ).toEqual(['Started 6 min ago', 'Downloaded in 10 min']);
  });
});

describe('installRecap', () => {
  const install = {
    version: '2026.36.0',
    installedAt: '2026-10-12T05:02:00Z',
    downloadMinutes: 15.5,
    installMinutes: 33,
    estimatedMinutes: 65,
  };

  it('summarizes what was recorded', () => {
    expect(installRecap(install)).toBe(
      'Downloaded in 16 min · Installed in 33 min (estimated 1 hr 5 min)',
    );
    expect(installRecap({ ...install, downloadMinutes: null, estimatedMinutes: null })).toBe(
      'Installed in 33 min',
    );
    expect(installRecap({ ...install, downloadMinutes: null, installMinutes: null })).toBeNull();
  });
});
