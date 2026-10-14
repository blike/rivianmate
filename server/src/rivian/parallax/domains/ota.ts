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
 * `ota.deployment.state`: repeated 1, each with 1 state and 2 version {1
 * "2026.36.0", 3 year, 4 week, 6 build}. State 1, sent 15 s after legacy
 * reported Install_Success, is read as otaCurrentVersion; other states may
 * be a pending update, so they're skipped.
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
  store: 'log',
  fieldNames: {
    '1.1': 'Deployment: state (1 installed)',
    '1.2.1': 'Deployment: version',
    '1.2.3': 'Deployment: year',
    '1.2.4': 'Deployment: week',
    '1.2.6': 'Deployment: build',
  },
});

// Logged for decoding; nothing reads these yet.
export const otaState = defineRvm({
  rvm: RVM_OTA_STATE,
  group: 'core',
  maturity: 'probe',
  store: 'log',
});

export const otaConfig = defineRvm({
  rvm: RVM_OTA_CONFIG,
  group: 'core',
  maturity: 'probe',
  store: 'log',
});

export const OTA_RVMS = [otaState, otaDeployment, otaConfig] as const;
