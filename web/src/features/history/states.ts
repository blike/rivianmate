import type { VehicleActivity } from './history';

/** How each vehicle state is drawn wherever state is shown over time. */
export const STATE_STYLE: Record<VehicleActivity, { label: string; fill: string; swatch: string }> =
  {
    driving: { label: 'Driving', fill: 'var(--series-1)', swatch: 'var(--series-1)' },
    charging: { label: 'Charging', fill: 'var(--status-good)', swatch: 'var(--status-good)' },
    updating: {
      label: 'Updating',
      fill: 'repeating-linear-gradient(135deg, var(--series-4) 0 3px, color-mix(in srgb, var(--series-4) 45%, transparent) 3px 6px)',
      swatch: 'var(--series-4)',
    },
    awake: {
      label: 'Awake',
      fill: 'color-mix(in srgb, var(--series-4) 80%, transparent)',
      swatch: 'var(--series-4)',
    },
    asleep: {
      label: 'Asleep',
      fill: 'color-mix(in srgb, var(--series-3) 45%, var(--surface-2))',
      swatch: 'color-mix(in srgb, var(--series-3) 70%, transparent)',
    },
  };

export const STATE_ORDER: VehicleActivity[] = [
  'driving',
  'charging',
  'updating',
  'awake',
  'asleep',
];
