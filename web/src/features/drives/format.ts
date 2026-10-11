import type { DriveDto } from '@server/api-types';
import { fmt, fmtDuration, fmtSeconds } from '../../lib/state';
import type { UnitFormatter } from '../../lib/units';

/** Battery % used; null when unknown or too small to show. */
export const batteryUsed = (d: Pick<DriveDto, 'startBattery' | 'endBattery'>) => {
  const used =
    d.startBattery != null && d.endBattery != null ? d.startBattery - d.endBattery : null;
  return used != null && Math.abs(used) >= 0.05 ? used : null;
};

/** Battery change as a signed percent: "−6.3%", or "+1.2%" if it rose (e.g. regen downhill). */
export const batteryChange = (used: number) => `${used > 0 ? '−' : '+'}${fmt(Math.abs(used), 1)}%`;

/** "2101 Ireland Grove Road, Bloomington" → "2101 Ireland Grove Road", for tight rows. */
export const shortPlace = (label: string) => label.split(',')[0]!.trim();

/** "38m · −6.3% · 1.84 mi/kWh" */
export function driveFacts(d: DriveDto, u: UnitFormatter): string {
  const used = batteryUsed(d);
  return [
    fmtDuration(d.startedAt, d.endedAt),
    used != null && batteryChange(used),
    d.energyKwh != null && u.formatEfficiency(d.distanceKm, d.energyKwh),
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Where a drive ended, or where it's headed while under way. */
export function destination(d: DriveDto): string {
  if (d.endedAt) return d.end ? shortPlace(d.end.label) : '—';
  return d.destination?.name ? `Navigating to ${d.destination.name}` : '…';
}

/** Axis labels for whole minutes into a drive: "25 min", or "1h 30m" style for drives of two hours or more. */
export function formatMinutes(totalMinutes: number) {
  return (m: number) => (totalMinutes >= 120 ? fmtSeconds(m * 60) : `${fmt(m, 0)} min`);
}

/** "47m (12:52 PM)": time into the drive, then the time of day. */
export function tooltipTime(startedAt: string) {
  const start = Date.parse(startedAt);
  return (m: number) => {
    const at = new Date(start + m * 60_000).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
    return `${fmtSeconds(m * 60)} (${at})`;
  };
}
