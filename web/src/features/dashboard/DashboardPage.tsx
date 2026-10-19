import type { VehicleDto } from '@server/api-types';
import { isTeslaMateVehicle } from '@server/teslamate/ids';
import { useInsights, useVehicleState } from '../../api/hooks';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { LoadingScope } from '../../components/LoadingState';
import { PageHeader, SectionRule } from '../../components/PageHeader';
import { Panel, Row } from '../../components/Panel';
import { ParkedEnergyPanel } from '../../components/ParkedEnergyPanel';
import { showLegacyOnly } from '../../lib/fieldSources';
import { sv, titleCase } from '../../lib/state';
import { brakeFluidLabel, chargePortLabel, twelveVoltLabel } from '../../lib/vehicleStatus';
import { ClimatePanel } from './ClimatePanel';
import { ConnectivityRows } from './ConnectivityPanel';
// import { DayStrip } from './DayStrip';
import { Overview } from './Overview';
import { RecentActivity } from './RecentActivity';
import { SchedulesSection } from './SchedulesSection';
import { VehiclePlan } from './VehiclePlan';

/** Label and value rows under hairlines, flowing into two columns from md up. */
const SPECS =
  'grid grid-cols-1 gap-x-10 text-sm md:grid-cols-2 [&>div]:border-t [&>div]:border-(--hairline) [&>div]:py-2.5';

export function DashboardPage(props: { vehicleId: string; vehicle?: VehicleDto }) {
  const { data: state, isPending } = useVehicleState(props.vehicleId);
  const { data: insights, isPending: insightsPending } = useInsights(props.vehicleId);
  const v = props.vehicle;
  const name = v?.name ?? v?.model ?? 'Vehicle';
  const model = [v?.modelYear, v?.model].filter(Boolean).join(' ');
  // TeslaMate doesn't log closures, schedules or the vehicle's systems.
  const teslamate = isTeslaMateVehicle(props.vehicleId);

  return (
    <>
      <PageHeader
        kicker={model && model !== name ? model : 'Overview'}
        title={name}
        action={
          <LoadingScope loading={isPending}>
            <FreshnessBadge state={state} />
          </LoadingScope>
        }
      />

      <div className="space-y-10">
        <div className="space-y-4">
          <LoadingScope loading={isPending}>
            <Overview vehicleId={props.vehicleId} vehicle={v} state={state} />
          </LoadingScope>
          {/* <DayStrip vehicleId={props.vehicleId} /> */}
        </div>

        <RecentActivity vehicleId={props.vehicleId} />

        {!teslamate && <SchedulesSection vehicleId={props.vehicleId} />}

        <section>
          <SectionRule>Vehicle</SectionRule>
          <LoadingScope loading={isPending}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-12">
              {/* Spans both rows at xl; the plan centers in whatever height they make. */}
              <Panel
                title={teslamate ? 'Tires' : 'Body & tires'}
                className="flex flex-col md:col-span-2 xl:col-span-5 xl:row-span-2"
              >
                <VehiclePlan state={state} vehicle={v} closures={!teslamate} />
              </Panel>

              {/* Without Systems (a Tesla), these two stack beside the plan. */}
              <Panel title="Climate" className={teslamate ? 'xl:col-span-7' : 'xl:col-span-3'}>
                <ClimatePanel state={state} />
              </Panel>

              <LoadingScope loading={isPending || insightsPending}>
                <Panel
                  title="Energy while parked"
                  className={teslamate ? 'xl:col-span-7' : 'xl:col-span-4'}
                >
                  <ParkedEnergyPanel insights={insights} columns={teslamate} />
                </Panel>

                {/* Two columns of readings from md up, so the list stays short. */}
                {!teslamate && (
                  <Panel title="Systems" className="md:col-span-2 xl:col-span-7">
                    <dl className={SPECS}>
                      <Row label="12V battery" value={twelveVoltLabel(state)} />
                      <Row label="Charge port" value={chargePortLabel(state)} />
                      <ConnectivityRows insights={insights} />
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
                        <Row label="Gear Guard" value={titleCase(sv(state, 'gearGuardLocked'))} />
                      )}
                    </dl>
                  </Panel>
                )}
              </LoadingScope>
            </div>
          </LoadingScope>
        </section>
      </div>
    </>
  );
}
