import type { VehicleState } from '@server/api-types';
import { StatusDot } from '../../components/Dot';
import { Skeleton, useLoading } from '../../components/LoadingState';
import { type ClosureStatus, closurePlaceholders, closureStatuses } from '../../lib/closures';

function ClosureRow(props: { status: ClosureStatus }) {
  // Lock state isn't shown per part: it's the same for all of them, and
  // the dashboard's Locked/Unlocked chip already covers it.
  const { label, closed } = props.status;
  const loading = useLoading();
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-(--text-secondary)">{label}</span>
      <span className="flex items-center gap-2">
        {loading ? (
          <Skeleton className="w-[4em]" />
        ) : (
          <>
            <StatusDot ok={closed} />
            <span>{closed ? 'Closed' : 'Open'}</span>
          </>
        )}
      </span>
    </div>
  );
}

export function ClosuresGrid(props: { state: VehicleState | undefined; model?: string | null }) {
  const loading = useLoading();
  const { closures, windows } = loading
    ? closurePlaceholders(props.model)
    : closureStatuses(props.state, props.model);
  return (
    <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
      <div>
        {closures.map((c) => (
          <ClosureRow key={c.key} status={c} />
        ))}
      </div>
      <div>
        {windows.map((w) => (
          <ClosureRow key={w.key} status={w} />
        ))}
      </div>
    </div>
  );
}
