import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useInsights, useVehicleState } from '../../api/hooks';
import { LoadingScope } from '../../components/LoadingState';
import { showLegacyOnly } from '../../lib/fieldSources';
import { sv } from '../../lib/state';
import { BatteryPanel } from './BatteryPanel';
import { Overview } from './Overview';
import { SoftwarePanel } from './SoftwarePanel';
import { TiresPanel } from './TiresPanel';

export function HealthPage(props: { vehicleId: string; model?: string | null }) {
  const { data: state, isPending: statePending } = useVehicleState(props.vehicleId);
  const {
    data: insights,
    isPending: insightsPending,
    isError: insightsError,
  } = useInsights(props.vehicleId);
  const {
    data: battery,
    isPending: batteryPending,
    isError: batteryError,
  } = useQuery({
    queryKey: ['batteryHealth', props.vehicleId],
    queryFn: () => api.batteryHealth(props.vehicleId),
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-4">
      {/* Battery health decides the pack's verdict, so everything waits for it. */}
      <LoadingScope loading={statePending || batteryPending}>
        <Overview state={state} battery={battery} batteryPending={batteryPending} />
      </LoadingScope>

      {(batteryError || insightsError) && (
        <p role="alert" className="text-sm text-(--status-critical)">
          Could not refresh vehicle health readings. Existing values may be out of date.
        </p>
      )}

      <BatteryPanel
        battery={battery}
        insights={insights}
        batteryPending={batteryPending || statePending}
        insightsPending={insightsPending}
        cellType={
          showLegacyOnly(state, 'batteryCellType') ? sv(state, 'batteryCellType') : undefined
        }
      />

      <TiresPanel
        vehicleId={props.vehicleId}
        state={state}
        statePending={statePending}
        model={props.model}
      />

      <SoftwarePanel vehicleId={props.vehicleId} />
    </div>
  );
}
