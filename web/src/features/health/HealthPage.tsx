import { isTeslaMateVehicle } from '@server/teslamate/ids';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useInsights, useVehicleState } from '../../api/hooks';
import { LoadingScope } from '../../components/LoadingState';
import { BatteryPanel } from './BatteryPanel';
import { Overview } from './Overview';
import { SoftwarePanel } from './SoftwarePanel';
import { TiresPanel } from './TiresPanel';

export function HealthPage(props: { vehicleId: string }) {
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
  // TeslaMate doesn't log the car's warnings or parked energy use.
  const teslamate = isTeslaMateVehicle(props.vehicleId);

  return (
    <div className="space-y-4">
      {!teslamate && (
        // Battery health decides the pack's verdict, so everything waits for it.
        <LoadingScope loading={statePending || batteryPending}>
          <Overview state={state} battery={battery} batteryPending={batteryPending} />
        </LoadingScope>
      )}

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
        parkedEnergy={!teslamate}
      />

      <TiresPanel vehicleId={props.vehicleId} state={state} statePending={statePending} />

      <SoftwarePanel vehicleId={props.vehicleId} />
    </div>
  );
}
