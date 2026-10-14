import type { VehicleDto } from '@server/api-types';
import { useInsights, useVehicleState } from '../../api/hooks';
import { LoadingScope } from '../../components/LoadingState';
import { Panel, Row } from '../../components/Panel';
import { ParkedEnergyPanel } from '../../components/ParkedEnergyPanel';
import { showLegacyOnly } from '../../lib/fieldSources';
import { sv, titleCase } from '../../lib/state';
import { brakeFluidLabel, chargePortLabel } from '../../lib/vehicleStatus';
import { BatteryEnergyPanel } from './BatteryEnergyPanel';
import { ClimatePanel } from './ClimatePanel';
import { ClosuresGrid } from './ClosuresGrid';
import { ConnectivityPanel } from './ConnectivityPanel';
import { Hero } from './Hero';
import { NavigationCard } from './NavigationCard';
import { RecentActivity } from './RecentActivity';
import { SectionHeading } from './SectionHeading';
import { TirePanel } from './TirePanel';

export function DashboardPage(props: { vehicleId: string; vehicle?: VehicleDto }) {
  const { data: state, isPending } = useVehicleState(props.vehicleId);
  const { data: insights, isPending: insightsPending } = useInsights(props.vehicleId);

  return (
    <div className="space-y-6">
      <LoadingScope loading={isPending}>
        <Hero vehicleId={props.vehicleId} vehicle={props.vehicle} state={state} />
      </LoadingScope>

      {insights?.navigation && <NavigationCard navigation={insights.navigation} />}

      <RecentActivity vehicleId={props.vehicleId} />

      <section>
        <SectionHeading>Vehicle details</SectionHeading>
        <LoadingScope loading={insightsPending}>
          <Panel title="Parked energy" className="mb-4">
            <ParkedEnergyPanel insights={insights} />
          </Panel>
        </LoadingScope>
        <LoadingScope loading={isPending}>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel title="Doors, closures & windows">
              <ClosuresGrid state={state} model={props.vehicle?.model} />
            </Panel>

            <Panel title="Tires">
              <TirePanel state={state} />
            </Panel>

            <Panel title="Climate">
              <ClimatePanel state={state} />
            </Panel>

            <Panel title="Vehicle health">
              <dl className="space-y-1 text-sm">
                <Row label="12V battery" value={titleCase(sv(state, 'twelveVoltBatteryHealth'))} />
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

            <LoadingScope loading={insightsPending}>
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
    </div>
  );
}
