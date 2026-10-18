/**
 * Every Parallax topic RivianMate knows. Subscription lists, storage,
 * the fields merged with legacy and the feed viewer's names all come from
 * here, so a new topic is one definition in its domain file.
 */
import type { VehicleState } from '../types.js';
import type { Maturity, ParallaxGroup, RvmDef } from './define.js';
import { BODY_RVMS } from './domains/body.js';
import { CHARGING_RVMS } from './domains/charging.js';
import { COMFORT_RVMS } from './domains/comfort.js';
import { DYNAMICS_RVMS } from './domains/dynamics.js';
import { ENERGY_RVMS } from './domains/energy.js';
import { NAVIGATION_RVMS } from './domains/navigation.js';
import { OTA_RVMS } from './domains/ota.js';
import { VEHICLE_RVMS } from './domains/vehicle.js';
import type { ParallaxMessage } from './wire.js';

export const PARALLAX_RVMS: readonly RvmDef[] = [
  ...ENERGY_RVMS,
  ...CHARGING_RVMS,
  ...DYNAMICS_RVMS,
  ...BODY_RVMS,
  ...COMFORT_RVMS,
  ...VEHICLE_RVMS,
  ...NAVIGATION_RVMS,
  ...OTA_RVMS,
];

const BY_RVM = new Map(PARALLAX_RVMS.map((def) => [def.rvm, def]));

export function rvmDef(rvm: string): RvmDef | undefined {
  return BY_RVM.get(rvm);
}

/**
 * Vehicles without this feature don't accept the Parallax subscription at
 * all — checked proactively so we never even attempt it for them, rather
 * than relying solely on Rivian rejecting it after the fact.
 */
export const PARALLAX_FEATURE_FLAG = 'VEHICLE_CONNECTIVITY_PARALLAX';

export function vehicleSupportsParallax(
  supportedFeatures: readonly string[] | null | undefined,
): boolean {
  return (supportedFeatures ?? []).includes(PARALLAX_FEATURE_FLAG);
}

export interface ParallaxGroupDef {
  id: ParallaxGroup;
  /** Only subscribed for vehicles with PARALLAX_FEATURE_FLAG. */
  needsFeatureFlag: boolean;
}

/**
 * The subscriptions, in the order they're sent. `core` is subscribed for
 * every vehicle, as it always has been; the rest only for vehicles that
 * advertise Parallax.
 */
export const PARALLAX_GROUPS: readonly ParallaxGroupDef[] = [
  { id: 'core', needsFeatureFlag: false },
  { id: 'dynamics', needsFeatureFlag: true },
  { id: 'vehicleState', needsFeatureFlag: true },
  { id: 'probe', needsFeatureFlag: true },
];

/** The subscription a topic rides on: probe until its decoding is verified. */
export function groupOf(def: { group: RvmDef['group']; maturity: Maturity }): ParallaxGroup {
  return def.maturity === 'probe' ? 'probe' : def.group;
}

/** A group's topics; empty groups aren't subscribed. */
export function parallaxGroupTopics(group: ParallaxGroup): string[] {
  return PARALLAX_RVMS.filter((def) => groupOf(def) === group).map((def) => def.rvm);
}

/** Rivian's domain: a topic's first segment, with the edge-compute graphs under energy. */
export function domainOf(rvm: string): string {
  const prefix = rvm.split('.')[0]!;
  return prefix === 'energy_edge_compute' ? 'energy' : prefix;
}

/**
 * VehicleState fields Parallax can supply. Legacy reports them too (except
 * on an R2), so these merge by timestamp: the newest reading wins, and a
 * delayed one can't replace newer data from the other feed.
 */
export const PARALLAX_STATE_FIELDS: readonly string[] = [
  ...new Set(PARALLAX_RVMS.flatMap((def) => def.stateKeys ?? [])),
];

/**
 * Fields Parallax supplies that legacy reports better (the odometer in
 * metres, not whole km): legacy's reading is used whenever it has one, and
 * Parallax's only where it has none (an R2). Charging schedules work the
 * same way, outside vehicle state: Parallax's next window stands in only
 * without legacy's schedules (VehicleMonitor.getSchedules).
 */
export const LEGACY_PREFERRED_FIELDS: readonly string[] = ['vehicleMileage'];

/** Topics whose latest payload is kept. */
export const PARALLAX_STORED_RVMS: ReadonlySet<string> = new Set(
  PARALLAX_RVMS.filter((def) => def.store).map((def) => def.rvm),
);

/** A message decoded by its topic's definition; `value` is null when unreadable. */
export interface Decoded<T = unknown> {
  def: RvmDef<T>;
  value: T | null;
}

/** The message decoded once, for every consumer; null for a topic with no definition. */
export function decodeMessage(message: ParallaxMessage): Decoded | null {
  const def = rvmDef(message.rvm);
  if (!def) return null;
  return { def, value: def.decode?.(message.payload) ?? null };
}

/** Narrows a decoded message to one topic's value type. */
export function isTopic<T>(decoded: Decoded | null, def: RvmDef<T>): decoded is Decoded<T> {
  return decoded?.def === def;
}

/** A decoded value as VehicleState fields; null when it carries none. */
export function stateFromDecoded(decoded: Decoded | null, timeStamp: string): VehicleState | null {
  if (!decoded?.def.toState || decoded.value == null) return null;
  const state = decoded.def.toState(decoded.value, timeStamp);
  return Object.keys(state).length > 0 ? state : null;
}

/**
 * A topic's message as the legacy fields it carries, stamped `timeStamp`,
 * in exactly legacy's values ("park", "closed", "close", "Off", …), so
 * consumers and stored history read the same either way. Null for topics
 * without legacy fields, or when nothing in the message could be read.
 */
export function vehicleStateFromParallax(
  rvm: string,
  payloadBase64: string,
  timeStamp: string,
): VehicleState | null {
  return stateFromDecoded(
    decodeMessage({ rvm, payload: payloadBase64, timestamp: null }),
    timeStamp,
  );
}
