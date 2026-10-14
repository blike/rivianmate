import type { VehicleState } from '../types.js';
import { fieldsOf } from './wire.js';

/**
 * The Parallax subscriptions a vehicle gets. Each has its own id, so a
 * vehicle refusing one topic loses only that group: `core` (energy,
 * charging, navigation, network), `dynamics` (GPS, tires), `vehicleState`
 * (gear, power, closures, cabin) and `probe` (topics still being worked out,
 * kept apart so they can't take a working group down with them).
 */
export type ParallaxGroup = 'core' | 'dynamics' | 'vehicleState' | 'probe';

/**
 * How far a topic's decoding is trusted. `confirmed`: checked against live
 * payloads. `partial`: some fields confirmed, or only recorded so far.
 * `probe`: unverified, so it's subscribed in the probe group.
 */
export type Maturity = 'confirmed' | 'partial' | 'probe';

/** One Parallax topic: how to subscribe to it, read it, keep it and use it. */
export interface RvmDef<T = unknown> {
  readonly rvm: string;
  /** The subscription it rides on, unless its maturity is `probe`. */
  readonly group: Exclude<ParallaxGroup, 'probe'>;
  readonly maturity: Maturity;
  /** Payload to typed value; null when it can't be read. Never throws. */
  decode?(payload: string): T | null;
  /** The legacy VehicleState fields the value stands in for, in legacy's values. */
  toState?(value: T, timeStamp: string): VehicleState;
  /** Every field toState can write; these merge newest-wins with legacy. */
  readonly stateKeys?: readonly string[];
  /** `latest` keeps the newest payload; `log` also keeps every distinct one for 30 days. */
  readonly store?: 'latest' | 'log';
  /** What each field path is read as, for the feed viewer ("3.1" is field 1 in field 3). */
  readonly fieldNames?: Readonly<Record<string, string>>;
}

export const defineRvm = <T>(def: RvmDef<T>): RvmDef<T> => def;

/** Legacy field values read from a topic, before they're timestamped. */
export type Readings = Record<string, string | number>;

/** Readings as VehicleState fields; null when there are none. */
export function readings(set: (put: (key: string, value: unknown) => void) => void) {
  const out: Readings = {};
  set((key, value) => {
    if (typeof value === 'string' || typeof value === 'number') out[key] = value;
  });
  return Object.keys(out).length > 0 ? out : null;
}

export function stampReadings(values: Readings, timeStamp: string): VehicleState {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, { timeStamp, value }]),
  );
}

/** A payload's fields, with an empty payload as an empty message (proto3 omits zeros). */
export const fieldsOrEmpty = (payloadBase64: string) =>
  fieldsOf(Buffer.from(payloadBase64, 'base64'));
