import type { VehicleState } from '@server/api-types';
import { closureStatuses } from './closures';
import { reportsBrakeFluid } from './fieldSources';
import { nv, sv, titleCase } from './state';

/** No reading from a vehicle with the sensors is an absent warning, not a missing level. */
export function brakeFluidLabel(state: VehicleState | undefined): string {
  if (!state || !reportsBrakeFluid(state)) return 'Unknown';
  if (state.brakeFluidLow == null) return 'Normal';
  const value = sv(state, 'brakeFluidLow');
  if (value === 'false') return 'OK';
  if (value === 'true') return 'Low';
  return value == null ? 'Unknown' : titleCase(value);
}

/** 12V battery health in words: NORMAL_OPERATION, as both feeds send it, is Normal. */
export function twelveVoltLabel(state: VehicleState | undefined): string {
  const value = sv(state, 'twelveVoltBatteryHealth');
  if (value == null) return '—';
  return /^(normal|normal_operation|ok)$/i.test(value) ? 'Normal' : titleCase(value.toLowerCase());
}

/** Rivian spells a shut charge port "close". */
export function chargePortLabel(state: VehicleState | undefined): string {
  const value = sv(state, 'chargePortState');
  return value === 'close' ? 'Closed' : titleCase(value);
}

/** Rivian's preconditioning statuses in words; its literal "undefined" is off. */
const PRECONDITIONING_LABELS: Record<string, string> = {
  undefined: 'Off',
  initiate: 'Starting',
  active: 'Active',
  active_warning: 'Active (warning)',
  complete_maintain: 'Holding temperature',
  timeout_temperature_not_achieved: 'Timed out before reaching temperature',
  timeout_complete: 'Timed out',
  error_soc_low: 'Battery too low',
  error_system_fault: 'System fault',
  unavailable: 'Unavailable',
};

/** The statuses with the cabin climate running. */
const PRECONDITIONING_RUNNING = new Set([
  'initiate',
  'active',
  'active_warning',
  'complete_maintain',
]);

export function preconditioningLabel(state: VehicleState | undefined): string {
  const value = sv(state, 'cabinPreconditioningStatus');
  if (value == null) return 'Unknown';
  return PRECONDITIONING_LABELS[value] ?? titleCase(value);
}

/** What started preconditioning, while it runs; null otherwise or when unknown. */
const PRECONDITIONING_TYPES: Record<string, string> = {
  USER_SELECTED: 'started by you',
  SCHEDULED: 'departure schedule',
  SCREEN_PROTECTION: 'screen protection',
  AUTO_CABIN_VENTILATION: 'cabin ventilation',
};

export function preconditioningCause(state: VehicleState | undefined): string | null {
  const status = sv(state, 'cabinPreconditioningStatus');
  if (!status || !PRECONDITIONING_RUNNING.has(status)) return null;
  return PRECONDITIONING_TYPES[sv(state, 'cabinPreconditioningType') ?? ''] ?? null;
}

/** How low the range is, when it's low; null when normal or unknown. */
const RANGE_LEVELS: Record<string, { label: string; level: 'warning' | 'critical' }> = {
  low: { label: 'Low range', level: 'warning' },
  red: { label: 'Very low range', level: 'critical' },
  critically_low: { label: 'Critically low range', level: 'critical' },
};

export function rangeLevel(
  state: VehicleState | undefined,
): { label: string; level: 'warning' | 'critical' } | null {
  return RANGE_LEVELS[sv(state, 'rangeThreshold') ?? ''] ?? null;
}

/** What the cold is doing to the range, when anything; null otherwise. */
export function coldRangeNote(state: VehicleState | undefined): string | null {
  const impact = sv(state, 'rangeTemperatureImpact');
  if (impact === 'cold_impact') return 'Reduced by the cold';
  if (impact === 'cold_may_impact') return 'The cold may reduce it';
  return null;
}

/**
 * Whether the climate is running: TeslaMate reports it on or off; for a
 * Rivian it's running while preconditioning, not while it's unavailable
 * (as when driving), timed out or faulted.
 */
export function climateRunning(state: VehicleState | undefined): boolean {
  const on = sv(state, 'climateOn');
  if (on != null) return on === 'true';
  return PRECONDITIONING_RUNNING.has(sv(state, 'cabinPreconditioningStatus') ?? '');
}

export type ActivityKind = 'driving' | 'charging' | 'plugged' | 'parked' | 'asleep';

/** What the vehicle is doing right now, for the dashboard's headline chip. */
export function vehicleActivity(
  state: VehicleState | undefined,
): { kind: ActivityKind; label: string } | null {
  if (!state) return null;
  const gear = sv(state, 'gearStatus');
  const power = sv(state, 'powerState');
  const speed = nv(state, 'gnssSpeed') ?? 0; // m/s
  const charger = sv(state, 'chargerStatus');
  if (gear === 'drive' || gear === 'reverse' || (power === 'go' && speed > 1)) {
    return { kind: 'driving', label: 'Driving' };
  }
  if (charger === 'chrgr_sts_connected_charging') return { kind: 'charging', label: 'Charging' };
  if (charger === 'chrgr_sts_connected_no_chrg') return { kind: 'plugged', label: 'Plugged in' };
  if (power === 'sleep') return { kind: 'asleep', label: 'Asleep' };
  return { kind: 'parked', label: 'Parked' };
}

/**
 * Locks and openings at a glance. `locked` is false if anything lockable is
 * unlocked, null if nothing reports a lock state.
 */
export function securitySummary(state: VehicleState | undefined, model: string | null | undefined) {
  const { closures, windows } = closureStatuses(state, model);
  const locks = closures.map((c) => c.locked).filter((l) => l !== null);
  const locked = locks.length === 0 ? null : locks.every(Boolean);
  const open = [...closures, ...windows].filter((c) => !c.closed).map((c) => c.label);
  const openLabel =
    open.length === 0
      ? 'All closed'
      : open.length === 1
        ? `${open[0]} open`
        : `${open.length} open`;
  return { locked, open, openLabel };
}
