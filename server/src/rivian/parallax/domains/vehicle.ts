/** `vehicle.*`: power state, connectivity and wheel sets. */
import { defineRvm, fieldsOrEmpty, readings, stampReadings } from '../define.js';
import { decodePayload } from '../wire.js';

export const RVM_POWER = 'vehicle.power.state';
export const RVM_NETWORK = 'vehicle.network.state';
export const RVM_WHEELS = 'vehicle.wheels.vehicle_wheels';

// Legacy's spellings; 5 and 7 are the app's names in its style.
const POWER_STATES: Record<number, string> = {
  1: 'sleep',
  2: 'standby',
  3: 'ready',
  4: 'go',
  5: 'vehicle_reset',
  6: 'ota_update',
  7: 'shutdown',
};

export interface NetworkState {
  wifi: { ssid: string; rssiDbm: number | null; frequencyMhz: number | null } | null;
  cellular: { carrier: string | null; technology: string | null } | null;
}

/**
 * `vehicle.network.state`: 4 Wi-Fi {3 SSID, 8 signal dBm, 10 frequency
 * MHz}, 5 cellular {1 carrier, 2 technology}. Wi-Fi without an SSID is not
 * connected; a signal of -255 is no reading.
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

/**
 * `vehicle.power.state`: 1 power state (1 sleep, 2 standby, 3 ready, 4 go,
 * 5 resetting, 6 installing an update, 7 shutting down).
 */
export const power = defineRvm({
  rvm: RVM_POWER,
  group: 'vehicleState',
  maturity: 'partial',
  decode: (payload) =>
    readings((put) => put('powerState', POWER_STATES[fieldsOrEmpty(payload)?.int(1) ?? 0])),
  toState: stampReadings,
  stateKeys: ['powerState'],
  fieldNames: {
    '1': 'Power state (1 sleep, 2 standby, 3 ready, 4 go, 5 reset, 6 updating, 7 shutdown)',
  },
});

export const network = defineRvm({
  rvm: RVM_NETWORK,
  group: 'core',
  maturity: 'confirmed',
  decode: decodeNetwork,
  store: true,
  fieldNames: {
    '1': 'Link in use (1 Wi-Fi, 2 cellular)',
    '2.1': 'Route (1 Wi-Fi, 2 cellular, 3 media, 4 hotspot)',
    '2.2': 'Route state (1 down, 2 up)',
    '3': 'Signal bars, link in use (1 = 0 bars … 5 = 4)',
    '4.1': 'Wi-Fi WPA state (2 connected)',
    '4.2': 'Wi-Fi connection check (2 succeeded)',
    '4.3': 'Wi-Fi SSID',
    '4.7': 'Wi-Fi bars (1 = 0 bars … 5 = 4)',
    '4.8': 'Wi-Fi signal (dBm; -255 none)',
    '4.9': 'Wi-Fi link speed (Mbps)',
    '4.10': 'Wi-Fi frequency (MHz)',
    '4.11': 'Wi-Fi channel width (MHz)',
    '4.12': 'Wi-Fi security (1 open, 2 WPA, 4 WPA2, 6 WPA3 personal)',
    '4.13': 'Wi-Fi secured (2 yes, 1 no)',
    '4.14': 'Wi-Fi switched on (2 yes, 1 no)',
    '5.1': 'Cellular carrier',
    '5.2': 'Cellular technology',
    '5.3': 'Cellular bars (1 = 0 bars … 5 = 4)',
    '5.4': 'Cellular signal (dBm; -255 none)',
  },
});

/** A wheel set and its rotation reminder; distances in metres. */
export interface WheelSet {
  installed: boolean;
  odometerAtLastRotationM: number;
  /** 0 when the reminder is off. */
  rotationIntervalM: number;
  /** The vehicle's odometer, when the topic carries it (an R1S leaves it out). */
  odometerM: number | null;
  /** When the interval was last changed. */
  updatedAt: string | null;
}

/**
 * `vehicle.wheels.vehicle_wheels`: repeated 1, a wheel set each: 1 package,
 * 2 tire odometer, 3/5 saved deltas (only on a set not fitted), 4 odometer
 * at last rotation, 6 rotation interval, 7 fitted, 8 updated {1 s}, 9
 * tires, 10 odometer; distances in metres, missing reads as 0. Field 2
 * isn't read: an R1S sends 1 m whatever it has driven.
 */
export function decodeWheels(payloadBase64: string): WheelSet[] {
  return (decodePayload(payloadBase64)?.repeated(1) ?? []).map((w) => {
    const updated = w.message(8)?.int(1);
    const odometer = w.int(10);
    return {
      installed: (w.int(7) ?? 0) !== 0,
      odometerAtLastRotationM: Math.max(0, w.int(4) ?? 0),
      rotationIntervalM: Math.max(0, w.int(6) ?? 0),
      odometerM: odometer != null && odometer > 0 ? odometer : null,
      updatedAt: updated ? new Date(updated * 1000).toISOString() : null,
    };
  });
}

export const wheels = defineRvm({
  rvm: RVM_WHEELS,
  group: 'vehicleState',
  maturity: 'partial',
  decode: decodeWheels,
  store: true,
  fieldNames: {
    '1.1': 'Wheels: package',
    '1.2': 'Wheels: tire distance (m)',
    '1.3': 'Wheels: saved tire distance (m; set not fitted)',
    '1.4': 'Wheels: odometer at last rotation (m)',
    '1.5': 'Wheels: saved odometer at last rotation (m; set not fitted)',
    '1.6': 'Wheels: rotate every (m; 0 off)',
    '1.7': 'Wheels: fitted',
    '1.8.1': 'Wheels: interval changed (s since epoch)',
    '1.9': 'Wheels: tires',
    '1.10': 'Wheels: odometer (m)',
  },
});

// Probes: archived to be worked out; nothing reads them yet.
export const activeProfile = defineRvm({
  rvm: 'vehicle.profiles.active_user',
  group: 'vehicleState',
  maturity: 'probe',
  store: true,
  fieldNames: { '1': 'Active driver profile id' },
});

export const VEHICLE_RVMS = [power, network, activeProfile, wheels] as const;
