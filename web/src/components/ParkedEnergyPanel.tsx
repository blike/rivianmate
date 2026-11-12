import type { VehicleInsightsDto } from '@server/api-types';
import { useParkedNights, useUnits } from '../api/hooks';
import {
  PARKED_USES,
  parkedNights,
  parkedSegments,
  parkedUnsplit,
  parkedWindows,
  recordedNights,
  windowLabel,
  type ParkedEnergyWindow,
} from '../lib/insights';
import { fmt } from '../lib/state';
import { BarReadout, useBarReadout, type BarReading } from './BarReadout';
import { Skeleton, useLoading } from './LoadingState';
import { ParkedWeek } from './ParkedWeek';
import { SplitBar, SplitLegend } from './SplitBar';

/**
 * Energy used while parked: one bar per window, split by use; side by side
 * from md with `columns`, and the week's nights stacked below both. Where the
 * source doesn't split it (TeslaMate), each bar is the window's total against
 * the largest.
 *
 * A bar's numbers live in its width, so a small window is a sliver: each one
 * is read by pointing at it, tapping it or tabbing to it, which prints the
 * window, its total and what the total was spent on.
 *
 * The week is drawn from the nights RivianMate has recorded, one per day; the
 * live report stands in only until the first has been written (a fresh
 * install, or a source that keeps no history), so the chart is never bare in
 * front of data the panel is already showing.
 */
export function ParkedEnergyPanel(props: {
  insights: VehicleInsightsDto | undefined;
  columns?: boolean;
  /** Whose nights to draw; without it the week falls back to the live report. */
  vehicleId?: string;
}) {
  const u = useUnits();
  const loading = useLoading();
  const energy = props.insights?.parkedEnergy;
  const windows = parkedWindows(energy?.windows ?? []);
  const { data: records } = useParkedNights(props.vehicleId);
  const nights = records?.length
    ? recordedNights(records)
    : parkedNights(energy?.windows ?? [], energy?.at ?? '');
  const split = windows.some((w) => w.uses != null);
  const largest = Math.max(0, ...windows.map((w) => w.kwh));
  if (!loading && windows.length === 0) {
    return <p className="text-sm text-(--text-muted)">No parked energy reported yet.</p>;
  }
  return (
    <div className="space-y-3">
      <div className={props.columns ? 'grid gap-x-8 gap-y-3 md:grid-cols-2' : 'space-y-3'}>
        {(loading ? [null, null] : windows).map((w, i) => (
          <WindowRow
            key={w?.minutes ?? i}
            energy={w}
            largest={largest}
            range={(km) => u.formatDistance(km)}
          />
        ))}
      </div>
      {(loading || split) && <SplitLegend items={[...PARKED_USES]} />}
      {/* Nights RivianMate has recorded, one row a day: a night it was off for
          keeps an empty slot (see recordedNights). */}
      {!loading && <ParkedWeek nights={nights} />}
    </div>
  );
}

/** A window's bar in words, for a screen reader: its length, total and uses. */
function labelOf(w: ParkedEnergyWindow): string {
  const uses = w.uses ? parkedSegments(w.uses) : [];
  const spent = uses.map((s) => `, ${s.label} ${fmt(s.kwh, 1)} kWh`).join('');
  return `${windowLabel(w.minutes)}: ${fmt(w.kwh, 1)} kWh used while parked${spent}`;
}

/** A window's reading, as its readout prints it: the window, total and uses. */
function readingOf(w: ParkedEnergyWindow): BarReading {
  return {
    heading: windowLabel(w.minutes),
    total: w.kwh,
    uses: w.uses ? parkedSegments(w.uses) : [],
    unsplit: parkedUnsplit(w.uses),
  };
}

/**
 * One window: its length and total above, its bar below, split by use where
 * the source splits it. The bar is the control that reads those numbers out,
 * so nothing has to be hit on a three-pixel sliver to learn what it drew.
 */
function WindowRow(props: {
  energy: ParkedEnergyWindow | null;
  largest: number;
  /** A window's range, in the reader's units. */
  range: (km: number) => string;
}) {
  const w = props.energy;
  const readout = useBarReadout<ParkedEnergyWindow>();
  const open = readout.open;
  const bar =
    w && !w.uses ? (
      <div className="parked-bar" aria-hidden>
        {w.kwh > 0 && (
          <div
            className="parked-bar__segment"
            style={{
              width: `${(w.kwh / props.largest) * 100}%`,
              background: 'var(--series-1)',
            }}
          />
        )}
      </div>
    ) : (
      <SplitBar
        segments={w?.uses ? parkedSegments(w.uses) : []}
        emptyLabel="No parked energy used"
        titles={false}
      />
    );
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-4 text-sm">
        <span className="text-(--text-secondary)">
          {w ? windowLabel(w.minutes) : <Skeleton className="w-[5em]" />}
        </span>
        <span className="tabular-nums">
          {w ? (
            `${fmt(w.kwh, 1)} kWh · ${props.range(w.rangeKm)}`
          ) : (
            <Skeleton className="w-[6em]" />
          )}
        </span>
      </div>
      {w ? (
        <div className="relative" {...readout.groupProps}>
          {open && <BarReadout reading={readingOf(open)} />}
          <button
            type="button"
            className="bar-readout__trigger"
            aria-label={labelOf(w)}
            {...readout.barProps(w)}
          >
            {bar}
          </button>
        </div>
      ) : (
        // Nothing reported yet: the window's track holds its place while it loads.
        bar
      )}
    </div>
  );
}
