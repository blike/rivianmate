import type { VehicleState } from '../types.js';
import { fieldsOf } from './wire.js';

/**
 * The Parallax subscriptions. A vehicle that refuses one topic refuses its
 * whole subscription, so topics are split: `core`, `dynamics` (GPS, tires),
 * `vehicleState`, and `probe` for topics not yet verified.
 */
export type ParallaxGroup = 'core' | 'dynamics' | 'vehicleState' | 'probe';

/**
 * How far a topic is trusted:
 * - confirmed: every field read has matched legacy (or captures) at every value seen.
 * - partial: read, with some values not yet seen matching.
 * - probe: archived only, on its own subscription; nothing reads it.
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
  /** Keeps the newest payload for quick reads; every topic is archived regardless. */
  readonly store?: boolean;
  /** What each field path is read as, for the feed viewer ("3.1" is field 1 in field 3). */
  readonly fieldNames?: Readonly<Record<string, string>>;
  /**
   * For the feed viewer: labels a repeated field's entries by a field inside
   * them, e.g. a closure by its position, replacing a name's "Closure:" prefix.
   */
  readonly entryLabels?: {
    readonly field: number;
    readonly key: number;
    readonly labels: Readonly<Record<number, string>>;
  };
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
