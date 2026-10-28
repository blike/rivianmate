/**
 * `ota.*`: software updates, being worked out against legacy's ota* fields;
 * only the installed version is read so far.
 */
import { defineRvm, readings, stampReadings } from '../define.js';
import { decodePayload } from '../wire.js';

export const RVM_OTA_STATE = 'ota.ota_state.vehicle_ota_state';
export const RVM_OTA_DEPLOYMENT = 'ota.deployment.state';
export const RVM_OTA_CONFIG = 'ota.user_schedule.ota_config';

/**
 * `ota.deployment.state`: repeated 1, a deployment per software category,
 * each with 1 category (1 firmware, 2 HD maps, 3 vehicle config), 2 the
 * installed version {1 "2026.36.0", 2 software version id, 3 year, 4 week,
 * 5 number, 6 git hash}, 3 deployment id, and 4 the update on offer {1
 * deployment id, only while one is in flight, 2 its version, 5 progress
 * {1 phase, 2 the last install's result, 3/4 download and install {2 %},
 * 5 what's holding it back, 6 countdown (s), 9 install length (min)}}.
 * Firmware's version, sent 15 s after legacy reported Install_Success, is
 * read as otaCurrentVersion; the others aren't the vehicle's software.
 */
export const otaDeployment = defineRvm({
  rvm: RVM_OTA_DEPLOYMENT,
  group: 'vehicleState',
  maturity: 'confirmed',
  decode: (payload) =>
    readings((put) => {
      for (const deployment of decodePayload(payload)?.repeated(1) ?? []) {
        const version = deployment.message(2)?.string(1);
        if (deployment.int(1) === 1 && version && /^\d{4}\.\d+\.\d+$/.test(version)) {
          put('otaCurrentVersion', version);
        }
      }
    }),
  toState: stampReadings,
  stateKeys: ['otaCurrentVersion'],
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

// Logged for decoding; nothing reads these yet.
export const otaState = defineRvm({
  rvm: RVM_OTA_STATE,
  group: 'core',
  maturity: 'probe',
  store: true,
});

export const otaConfig = defineRvm({
  rvm: RVM_OTA_CONFIG,
  group: 'core',
  maturity: 'probe',
  store: true,
});

export const OTA_RVMS = [otaState, otaDeployment, otaConfig] as const;
