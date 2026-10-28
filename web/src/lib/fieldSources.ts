import type { VehicleInsightsDto, VehicleState } from '@server/api-types';

/**
 * Fields not every vehicle sends, left out rather than shown as unknown.
 * Cell type comes only from the legacy feed, so a vehicle without it (an
 * R2, or with legacy switched off) never has one; the rest come from
 * either feed, but Parallax doesn't send them on every vehicle.
 */
export const OPTIONAL_FIELDS = [
  'batteryCellType',
  'brakeFluidLow',
  'driveMode',
  'gearGuardLocked',
  'wiperFluidState',
] as const;

/**
 * Readings only Parallax sends: the R2's feed, which other models get too.
 * Left out until it has sent one.
 */
export const PARALLAX_ONLY_READINGS = ['cellTemps'] as const;

/** Whether to show an optional field: while loading, then once the vehicle has sent it. */
export function showOptional(
  state: VehicleState | undefined,
  field: (typeof OPTIONAL_FIELDS)[number],
): boolean {
  if (state == null) return true;
  return field === 'brakeFluidLow' ? reportsBrakeFluid(state) : field in state;
}

/**
 * Whether the vehicle has brake fluid readings. Legacy sends brake fluid
 * empty while it's fine, as it sends every field on a vehicle without the
 * legacy feed (an R2), so washer fluid, from the same sensors, tells them
 * apart until Parallax sends one.
 */
export function reportsBrakeFluid(state: VehicleState): boolean {
  return 'brakeFluidLow' in state || 'wiperFluidState' in state;
}

/** Whether to show a Parallax-only reading: while loading, then once Parallax has sent it. */
export function showParallaxOnly(
  insights: VehicleInsightsDto | undefined,
  key: (typeof PARALLAX_ONLY_READINGS)[number],
): boolean {
  return insights == null || insights[key] != null;
}
