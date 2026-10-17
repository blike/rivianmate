/** `vehicle.*`: power state and connectivity. */
import { defineRvm, fieldsOrEmpty, readings, stampReadings } from '../define.js';
import { decodePayload } from '../wire.js';

export const RVM_POWER = 'vehicle.power.state';
export const RVM_NETWORK = 'vehicle.network.state';

const POWER_STATES: Record<number, string> = { 1: 'sleep', 2: 'standby', 3: 'ready', 4: 'go' };

export interface NetworkState {
  wifi: { ssid: string; rssiDbm: number | null; frequencyMhz: number | null } | null;
  cellular: { carrier: string | null; technology: string | null } | null;
}

/**
 * `vehicle.network.state`: 4 Wi-Fi {3 SSID, 8 RSSI dBm, 10 frequency MHz},
 * 5 cellular {1 carrier, 2 technology}. A Wi-Fi block without an SSID
 * means not connected. Also in the Wi-Fi block, not read: 1 state (2
 * connected), 12 (4 connected, 1 not) and 13 (2 connected, 1 not), each
 * matching the SSID in all 283 messages, and 11 channel width (MHz),
 * always 80 at 5240 MHz and 20 at 2427 MHz (R1S, 2026-10-13).
 */
export function decodeNetwork(payloadBase64: string): NetworkState | null {
  const m = decodePayload(payloadBase64);
  if (!m) return null;
  const wifi = m.message(4);
  const cell = m.message(5);
  const ssid = wifi?.string(3);
  const rssi = wifi?.int(8) ?? null;
  const frequency = wifi?.int(10) ?? null;
  const carrier = cell?.string(1) || null;
  const technology = cell?.string(2) || null;
  return {
    wifi: ssid
      ? {
          ssid,
          rssiDbm: rssi != null && rssi < 0 && rssi > -130 ? rssi : null,
          frequencyMhz: frequency && frequency > 0 ? frequency : null,
        }
      : null,
    cellular: carrier || technology ? { carrier, technology } : null,
  };
}

/** `vehicle.power.state`: 1 power state (1 sleep, 2 standby, 3 ready, 4 go). */
export const power = defineRvm({
  rvm: RVM_POWER,
  group: 'vehicleState',
  maturity: 'partial',
  decode: (payload) =>
    readings((put) => put('powerState', POWER_STATES[fieldsOrEmpty(payload)?.int(1) ?? 0])),
  toState: stampReadings,
  stateKeys: ['powerState'],
  fieldNames: { '1': 'Power state (1 sleep, 2 standby, 3 ready, 4 go)' },
});

export const network = defineRvm({
  rvm: RVM_NETWORK,
  group: 'core',
  maturity: 'confirmed',
  decode: decodeNetwork,
  store: 'latest',
  fieldNames: {
    '4.1': 'Wi-Fi state (2 connected)',
    '4.3': 'Wi-Fi SSID',
    '4.8': 'Wi-Fi signal (dBm)',
    '4.10': 'Wi-Fi frequency (MHz)',
    '4.11': 'Wi-Fi channel width (MHz)',
    '4.12': 'Wi-Fi connected (4 connected, 1 not)',
    '4.13': 'Wi-Fi connected (2 connected, 1 not)',
    '5.1': 'Cellular carrier',
    '5.2': 'Cellular technology',
  },
});

export const VEHICLE_RVMS = [power, network] as const;
