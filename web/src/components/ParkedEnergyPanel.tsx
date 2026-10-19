import type { VehicleInsightsDto } from '@server/api-types';
import { useUnits } from '../api/hooks';
import { PARKED_USES, parkedSegments, parkedWindows, windowLabel } from '../lib/insights';
import { fmt } from '../lib/state';
import { Skeleton, useLoading } from './LoadingState';
import { SplitBar, SplitLegend } from './SplitBar';

/** Energy used while parked: one bar per window, split by use; side by side from md with `columns`. */
export function ParkedEnergyPanel(props: {
  insights: VehicleInsightsDto | undefined;
  columns?: boolean;
}) {
  const u = useUnits();
  const loading = useLoading();
  const windows = parkedWindows(props.insights?.parkedEnergy?.windows ?? []);
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
            <SplitBar
              segments={w ? parkedSegments(w.uses) : []}
              emptyLabel="No parked energy used"
            />
          </div>
        ))}
      </div>
      <SplitLegend items={[...PARKED_USES]} />
    </div>
  );
}
