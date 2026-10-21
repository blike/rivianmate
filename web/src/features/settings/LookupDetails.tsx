import type { LookupSettings } from '../../api/client';

/**
 * What each outside lookup sends and what it adds, worded once: in full for
 * setup, and as a one-line summary for Settings.
 */
export const LOOKUPS: Record<
  keyof LookupSettings,
  { label: string; service: string; sends: string; adds: string; off: string; summary: string }
> = {
  addresses: {
    label: 'Addresses',
    service: 'OpenStreetMap',
    sends: 'Where each drive starts and ends. A spot already looked up isn’t sent again.',
    adds: 'Street names for drives on the dashboard, the Drives page, and Places on History.',
    off: "Places you haven't saved show as coordinates.",
    summary: 'Street names for drives, from OpenStreetMap. Sends where each drive starts and ends.',
  },
  weather: {
    label: 'Weather',
    service: 'Open-Meteo',
    sends: 'A point every 10 minutes along each drive, and its date. No times are sent.',
    adds: 'Temperature, conditions and wind on each drive, and efficiency by weather on History.',
    off: 'Drives have no weather, and those charts are hidden.',
    summary: 'Temperature, conditions and wind, from Open-Meteo. Sends points along each drive.',
  },
};

/**
 * "Sends" and "Adds" lines; off, they say nothing is sent and what's missing.
 * Each line's two versions share a grid cell, the hidden one invisible, so it
 * keeps the taller one's height and nothing moves when the switch flips.
 */
export function LookupDetails(props: { lookup: keyof LookupSettings; on: boolean }) {
  const l = LOOKUPS[props.lookup];
  const layer = (shown: boolean) => `col-start-1 row-start-1 ${shown ? '' : 'invisible'}`;
  return (
    <dl className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs leading-relaxed text-(--text-muted)">
      <dt className="font-medium text-(--text-secondary)">Sends</dt>
      <dd className="grid">
        <span className={layer(props.on)}>{l.sends}</span>
        <span className={layer(!props.on)}>Nothing.</span>
      </dd>
      <dt className="grid font-medium text-(--text-secondary)">
        <span className={layer(props.on)}>Adds</span>
        <span className={layer(!props.on)}>Off</span>
      </dt>
      <dd className="grid">
        <span className={layer(props.on)}>{l.adds}</span>
        <span className={layer(!props.on)}>{l.off}</span>
      </dd>
    </dl>
  );
}
