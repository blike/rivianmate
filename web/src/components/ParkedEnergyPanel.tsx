import type { VehicleInsightsDto } from '@server/api-types';
import { useParkedNights, useUnits } from '../api/hooks';
import {
  PARKED_USES,
  parkedNights,
  parkedSegments,
  parkedWindows,
  recordedNights,
  windowLabel,
} from '../lib/insights';
import { fmt } from '../lib/state';
import { Skeleton, useLoading } from './LoadingState';
import { ParkedWeek } from './ParkedWeek';
import { SplitBar, SplitLegend } from './SplitBar';

/**
 * Energy used while parked: one bar per window, split by use; side by side
 * from md with `columns`, and the week's nights stacked below both. Where the
 * source doesn't split it (TeslaMate), each bar is the window's total against
 * the largest.
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
          <div key={w?.minutes ?? i}>
            <div className="mb-1.5 flex items-baseline justify-between gap-4 text-sm">
              <span className="text-(--text-secondary)">
                {w ? windowLabel(w.minutes) : <Skeleton className="w-[5em]" />}
              </span>
              <span className="tabular-nums">
                {w ? (
                  `${fmt(w.kwh, 1)} kWh · ${u.formatDistance(w.rangeKm)}`
                ) : (
                  <Skeleton className="w-[6em]" />
                )}
              </span>
            </div>
            {w && !w.uses ? (
              <div
                className="parked-bar"
                role="img"
                aria-label={`${fmt(w.kwh, 1)} kWh used while parked`}
              >
                {w.kwh > 0 && (
                  <div
                    className="parked-bar__segment"
                    style={{ width: `${(w.kwh / largest) * 100}%`, background: 'var(--series-1)' }}
                  />
                )}
              </div>
            ) : (
              <SplitBar
                segments={w?.uses ? parkedSegments(w.uses) : []}
                emptyLabel="No parked energy used"
              />
            )}
          </div>
        ))}
      </div>
      {(loading || split) && <SplitLegend items={[...PARKED_USES]} />}
      {/* Nights RivianMate has recorded, one row a day: a night it was off for
          keeps an empty slot (see recordedNights). */}
      {!loading && <ParkedWeek nights={nights} />}
    </div>
  );
}
