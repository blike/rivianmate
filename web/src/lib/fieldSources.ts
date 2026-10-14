import type { VehicleInsightsDto, VehicleState } from '@server/api-types';

/**
 * Fields only the legacy feed reports. A vehicle without it (an R2, or with
 * legacy switched off) never sends them, so they're left out rather than
 * shown as unknown.
 */
export const LEGACY_ONLY_FIELDS = [
  'batteryCellType',
  'batteryHvThermalEvent',
  'brakeFluidLow',
  'driveMode',
  'gearGuardLocked',
  'petModeStatus',
  'wiperFluidState',
] as const;

/**
 * Readings only Parallax sends: the R2's feed, which other models get too.
 * Left out until it has sent one.
 */
export const PARALLAX_ONLY_READINGS = ['cellTemps'] as const;

/** Whether to show a legacy-only field: while loading, then once legacy has sent it. */
export function showLegacyOnly(
  state: VehicleState | undefined,
  field: (typeof LEGACY_ONLY_FIELDS)[number],
): boolean {
  // Brake fluid sent as null is a reading (normal), so it's presence that counts.
  return state == null || field in state;
}

/** Whether to show a Parallax-only reading: while loading, then once Parallax has sent it. */
export function showParallaxOnly(
  insights: VehicleInsightsDto | undefined,
  key: (typeof PARALLAX_ONLY_READINGS)[number],
): boolean {
  return insights == null || insights[key] != null;
}
