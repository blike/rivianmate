import type { VehicleState } from '@server/api-types';
import { describe, expect, it } from 'vitest';
import { installTimeLabel, lastInstallFailed, softwareUpdate, typicalUpdateGapDays } from './ota';

const v = (value: string | number) => ({ timeStamp: 't', value });
const state = (fields: Record<string, string | number>) =>
  Object.fromEntries(Object.entries(fields).map(([k, x]) => [k, v(x)])) as unknown as VehicleState;

const base = { otaCurrentVersion: '2026.31.0', otaAvailableVersion: '2026.36.0' };

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
    expect(at('Downloading')).toMatchObject({ phase: 'downloading', progress: null });
    expect(at('Preparing')).toMatchObject({ phase: 'preparing', label: 'Preparing' });
    expect(at('Ready_To_Install')).toMatchObject({ phase: 'ready' });
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

  it('ignores a leftover status once nothing is pending', () => {
    const done = { otaCurrentVersion: '2026.36.0', otaAvailableVersion: '0.0.0' };
    expect(softwareUpdate(state({ ...done, otaStatus: 'Ready_To_Download' }))).toBeNull();
    expect(softwareUpdate(state({ ...done, otaStatus: 'Connection_Lost' }))).toBeNull();
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
  });
});

describe('installTimeLabel', () => {
  it('formats minutes', () => {
    expect(installTimeLabel(25)).toBe('About 25 min');
    expect(installTimeLabel(60)).toBe('About 1 hr');
    expect(installTimeLabel(65)).toBe('About 1 hr 5 min');
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
