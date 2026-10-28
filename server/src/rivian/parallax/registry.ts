/** Every Parallax topic RivianMate knows, and what's derived from them. */
import type { VehicleState } from '../types.js';
import type { RvmDef } from './define.js';
import { BODY_RVMS } from './domains/body.js';
import { CHARGING_RVMS } from './domains/charging.js';
import { COMFORT_RVMS } from './domains/comfort.js';
import { DEPARTURE_RVMS } from './domains/departure.js';
import { DYNAMICS_RVMS } from './domains/dynamics.js';
import { ENERGY_RVMS } from './domains/energy.js';
import { NAVIGATION_RVMS } from './domains/navigation.js';
import { OTA_RVMS } from './domains/ota.js';
import { SECURITY_RVMS } from './domains/security.js';
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
  ...SECURITY_RVMS,
  ...DEPARTURE_RVMS,
];

const BY_RVM = new Map(PARALLAX_RVMS.map((def) => [def.rvm, def]));

export function rvmDef(rvm: string): RvmDef | undefined {
  return BY_RVM.get(rvm);
}

/** Vehicles without this feature refuse Parallax, so it isn't tried for them. */
export const PARALLAX_FEATURE_FLAG = 'VEHICLE_CONNECTIVITY_PARALLAX';

export function vehicleSupportsParallax(
  supportedFeatures: readonly string[] | null | undefined,
): boolean {
  return (supportedFeatures ?? []).includes(PARALLAX_FEATURE_FLAG);
}

/** Whether nothing reads a topic yet: it has no decoder. */
export const isProbe = (def: Pick<RvmDef, 'decode'>): boolean => !def.decode;

/**
 * What a vehicle without PARALLAX_FEATURE_FLAG is subscribed to, by name:
 * charging, the battery, navigation and the network. A vehicle with it
 * gets every topic, unnamed, so a topic it doesn't have can't refuse the
 * rest, and Rivian's new topics arrive without being listed.
 */
export const PARALLAX_CORE_TOPICS: readonly string[] = [
  'energy_edge_compute.graphs.charging_graph_global',
  'energy_edge_compute.graphs.charge_session_breakdown',
  'energy_edge_compute.graphs.cold_weather_soc',
  'energy_edge_compute.graphs.parked_energy_distributions',
  'energy.high_voltage.battery_state',
  'energy.high_voltage.battery_characteristics',
  'charging.session.status',
  'charging.session.time_estimation',
  'charging.session.soc_slider',
  'charging.schedule.time_window',
  'vehicle.network.state',
  'navigation.navigation_service.trip_info',
  'navigation.navigation_service.trip_progress',
];

/** Rivian's domain: a topic's first segment, with the edge-compute graphs under energy. */
export function domainOf(rvm: string): string {
  const prefix = rvm.split('.')[0]!;
  return prefix === 'energy_edge_compute' ? 'energy' : prefix;
}

/** VehicleState fields Parallax supplies; they merge with legacy's, newest reading wins. */
export const PARALLAX_STATE_FIELDS: readonly string[] = [
  ...new Set(PARALLAX_RVMS.flatMap((def) => def.stateKeys ?? [])),
];

/**
 * Fields legacy reports better (the odometer in metres, not whole km):
 * Parallax's are used only where legacy has none, as on an R2.
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
 * A message as the legacy fields it carries, in legacy's spellings, stamped
 * `timeStamp`; null when it carries none.
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
