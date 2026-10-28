/** `ota.*`: software updates: the installed version and the update on offer. */
import { defineRvm, readings, stampReadings } from '../define.js';
import { decodePayload } from '../wire.js';

export const RVM_OTA_STATE = 'ota.ota_state.vehicle_ota_state';
export const RVM_OTA_DEPLOYMENT = 'ota.deployment.state';
export const RVM_OTA_CONFIG = 'ota.user_schedule.ota_config';

const VERSION = /^\d{4}\.\d+\.\d+$/;

/** Legacy's otaStatus spellings, by phase. */
const OTA_STATUSES: Record<number, string> = {
  1: 'Idle',
  2: 'Ready_To_Download',
  3: 'Fault',
  4: 'Connection_Lost',
  5: 'Install_Countdown',
  6: 'Preparing',
  7: 'Downloading',
  8: 'Ready_To_Install',
  9: 'Scheduled_To_Install',
  10: 'Awaiting_Install',
  11: 'Installing',
  12: 'Install_Success',
  13: 'Download_Failed',
  14: 'Install_Failed',
};

/** Legacy's otaCurrentStatus spellings: the last install's result. */
const LAST_INSTALL: Record<number, string> = {
  1: 'Install_Success',
  2: 'Install_Failed',
  3: 'Install_Unable_To_Start',
};

/**
 * `ota.deployment.state`: repeated 1, a deployment per software category
 * (1 firmware, 2 HD maps, 3 vehicle config), each with 2 the installed
 * version {1 "2026.36.0"} and 4 the update on offer {2 version, 5 progress}.
 * Firmware's is read, in legacy's fields and spellings; with nothing on
 * offer the version is "0.0.0", as legacy sends it.
 */
export const otaDeployment = defineRvm({
  rvm: RVM_OTA_DEPLOYMENT,
  group: 'vehicleState',
  decode: (payload) =>
    readings((put) => {
      for (const deployment of decodePayload(payload)?.repeated(1) ?? []) {
        if (deployment.int(1) !== 1) continue;
        const version = deployment.message(2)?.string(1);
        if (version && VERSION.test(version)) put('otaCurrentVersion', version);
        const update = deployment.message(4);
        if (!update) continue;
        const target = update.message(2)?.string(1);
        put('otaAvailableVersion', target && VERSION.test(target) ? target : '0.0.0');
        const progress = update.message(5);
        if (!progress) continue;
        put('otaStatus', OTA_STATUSES[progress.int(1) ?? 0]);
        put('otaCurrentStatus', LAST_INSTALL[progress.int(2) ?? 0]);
        // proto3 leaves zeros out: an absent percentage or length is 0.
        put('otaDownloadProgress', progress.message(3)?.int(2) ?? 0);
        put('otaInstallProgress', progress.message(4)?.int(2) ?? 0);
        put('otaInstallDuration', progress.int(9) ?? 0);
      }
    }),
  toState: stampReadings,
  stateKeys: [
    'otaCurrentVersion',
    'otaAvailableVersion',
    'otaStatus',
    'otaCurrentStatus',
    'otaDownloadProgress',
    'otaInstallProgress',
    'otaInstallDuration',
  ],
  store: true,
  fieldNames: {
    '1.1': 'Deployment: software (1 firmware, 2 HD maps, 3 vehicle config)',
    '1.2.1': 'Deployment: installed version',
    '1.2.2': 'Deployment: software version id',
    '1.2.3': 'Deployment: year',
    '1.2.4': 'Deployment: week',
    '1.2.5': 'Deployment: number',
    '1.2.6': 'Deployment: git hash',
    '1.3': 'Deployment: id',
    '1.4.1': 'Update: deployment id (while in flight)',
    '1.4.2.1': 'Update: version',
    '1.4.5.1': 'Update: phase',
    '1.4.5.2': 'Update: last install (1 success, 2 failed, 3 unable to start)',
    '1.4.5.3.2': 'Update: downloaded (%)',
    '1.4.5.4.2': 'Update: installed (%)',
    '1.4.5.6': 'Update: countdown (s)',
    '1.4.5.9': 'Update: install length (min)',
  },
});

// Probes: archived to be worked out; nothing reads them yet.
export const otaState = defineRvm({
  rvm: RVM_OTA_STATE,
  group: 'core',
  store: true,
});

export const otaConfig = defineRvm({
  rvm: RVM_OTA_CONFIG,
  group: 'core',
  store: true,
});

export const OTA_RVMS = [otaState, otaDeployment, otaConfig] as const;
