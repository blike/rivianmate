import type { VehicleDto, VehicleInsightsDto, VehicleState } from '@server/api-types';
import { isTeslaMateVehicle } from '@server/teslamate/ids';
import { useInsights, useVehicleState } from '../../api/hooks';
import { LoadingScope } from '../../components/LoadingState';
import { Panel, Row } from '../../components/Panel';
import { ParkedEnergyPanel } from '../../components/ParkedEnergyPanel';
import { showLegacyOnly } from '../../lib/fieldSources';
import { sv, titleCase } from '../../lib/state';
import { brakeFluidLabel, chargePortLabel, twelveVoltLabel } from '../../lib/vehicleStatus';
import { BatteryEnergyPanel } from './BatteryEnergyPanel';
import { ClimatePanel } from './ClimatePanel';
import { ClosuresGrid } from './ClosuresGrid';
import { ConnectivityPanel } from './ConnectivityPanel';
import { Hero } from './Hero';
import { RecentActivity } from './RecentActivity';
import { SectionHeading } from './SectionHeading';
import { TeslaClimatePanel } from './TeslaClimatePanel';
import { TirePanel } from './TirePanel';

export function DashboardPage(props: { vehicleId: string; vehicle?: VehicleDto }) {
  const { data: state, isPending } = useVehicleState(props.vehicleId);
  const { data: insights, isPending: insightsPending } = useInsights(props.vehicleId);

  return (
    <div className="space-y-6">
      <LoadingScope loading={isPending}>
        <Hero vehicleId={props.vehicleId} vehicle={props.vehicle} state={state} />
      </LoadingScope>

      <RecentActivity vehicleId={props.vehicleId} />

      {isTeslaMateVehicle(props.vehicleId) ? (
        <TeslaDetails state={state} loading={isPending} />
      ) : (
        <RivianDetails
          state={state}
          insights={insights}
          model={props.vehicle?.model}
          loading={isPending}
          insightsLoading={insightsPending}
        />
      )}
    </div>
  );
}

function RivianDetails(props: {
  state: VehicleState | undefined;
  insights: VehicleInsightsDto | undefined;
  model: string | null | undefined;
  loading: boolean;
  insightsLoading: boolean;
}) {
  const { state, insights } = props;
  return (
    <section>
      <SectionHeading>Vehicle details</SectionHeading>
      <LoadingScope loading={props.insightsLoading}>
        <Panel title="Parked energy" className="mb-4">
          <ParkedEnergyPanel insights={insights} />
        </Panel>
      </LoadingScope>
      <LoadingScope loading={props.loading}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel title="Doors, closures & windows">
            <ClosuresGrid state={state} model={props.model} />
          </Panel>

          <Panel title="Tires">
            <TirePanel state={state} />
          </Panel>

          <Panel title="Climate">
            <ClimatePanel state={state} />
          </Panel>

          <Panel title="Vehicle health">
            <dl className="space-y-1 text-sm">
              <Row label="12V battery" value={twelveVoltLabel(state)} />
              {showLegacyOnly(state, 'brakeFluidLow') && (
                <Row label="Brake fluid" value={brakeFluidLabel(state)} />
              )}
              {showLegacyOnly(state, 'wiperFluidState') && (
                <Row label="Wiper fluid" value={titleCase(sv(state, 'wiperFluidState'))} />
              )}
              {showLegacyOnly(state, 'driveMode') && (
                <Row label="Drive mode" value={titleCase(sv(state, 'driveMode'))} />
              )}
              {showLegacyOnly(state, 'gearGuardLocked') && (
                <Row label="Gear guard" value={titleCase(sv(state, 'gearGuardLocked'))} />
              )}
              <Row label="Charge port" value={chargePortLabel(state)} />
            </dl>
          </Panel>

          <LoadingScope loading={props.insightsLoading}>
            <Panel title="Battery & energy">
              <BatteryEnergyPanel
                insights={insights}
                cellType={
                  showLegacyOnly(state, 'batteryCellType')
                    ? sv(state, 'batteryCellType')
                    : undefined
                }
              />
            </Panel>

            <Panel title="Connectivity">
              <ConnectivityPanel insights={insights} />
            </Panel>
          </LoadingScope>
        </div>
      </LoadingScope>
    </section>
  );
}

/** What TeslaMate logs: tires and climate. It doesn't record locks or closures. */
function TeslaDetails(props: { state: VehicleState | undefined; loading: boolean }) {
  return (
    <section>
      <SectionHeading>Vehicle details</SectionHeading>
      <LoadingScope loading={props.loading}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel title="Tires">
            <TirePanel state={props.state} />
          </Panel>
          <Panel title="Climate">
            <TeslaClimatePanel state={props.state} />
          </Panel>
        </div>
      </LoadingScope>
    </section>
  );
}
