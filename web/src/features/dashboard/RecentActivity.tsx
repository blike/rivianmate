import { useEffect, useState } from 'react';
import {
  useChargingSessions,
  useDrives,
  useInsights,
  useLiveCharging,
  useSchedules,
  useVehicleState,
} from '../../api/hooks';
import { LoadingScope } from '../../components/LoadingState';
import { isChargingLive, liveCharge } from '../../lib/liveCharge';
import { nv, sv } from '../../lib/state';
import { vehicleActivity } from '../../lib/vehicleStatus';
import { scheduleStatus } from './schedules';
import { LastChargeCard } from './LastChargeCard';
import { LastDriveCard } from './LastDriveCard';
import { SectionRule } from '../../components/PageHeader';
import { WeekCard } from './WeekCard';

/** Last drive and last charge, each linking to its page, and the week so far. */
export function RecentActivity(props: { vehicleId: string }) {
  const { data: drives, isPending: drivesPending } = useDrives(props.vehicleId);
  const { data: state } = useVehicleState(props.vehicleId);
  const { data: sessions, isPending: sessionsPending } = useChargingSessions(props.vehicleId);
  const { data: insights } = useInsights(props.vehicleId);
  const { data: live } = useLiveCharging(props.vehicleId);
  // When a vehicle plugged in but not charging will start.
  const { data: schedules } = useSchedules(props.vehicleId);
  // Keeps "2 h ago" and a live drive's duration current.
  const driving = drives?.[0] != null && !drives[0].endedAt;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), driving ? 15_000 : 60_000);
    return () => clearInterval(t);
  }, [driving]);

  return (
    <section>
      <SectionRule>Recent activity</SectionRule>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)]">
        <LoadingScope loading={drivesPending}>
          <LastDriveCard
            drive={drives?.[0]}
            now={now}
            speedMps={nv(state, 'gnssSpeed')}
            inGear={state ? vehicleActivity(state)?.kind === 'driving' : undefined}
            navigation={insights?.navigation}
            navigationLoaded={insights !== undefined}
          />
        </LoadingScope>
        <LoadingScope loading={sessionsPending}>
          <LastChargeCard
            plug={state ? plugState(sv(state, 'chargerStatus')) : undefined}
            stateLoaded={state !== undefined}
            session={sessions?.[0]}
            now={now}
            charge={liveCharge(isChargingLive(live) ? live : null, state)}
            schedule={
              schedules
                ? scheduleStatus(
                    (schedules.charging ?? []).filter((c) => c.enabled !== false),
                    new Date(now),
                  )
                : undefined
            }
          />
        </LoadingScope>
        <LoadingScope loading={drivesPending || sessionsPending}>
          <div className="md:col-span-2 2xl:col-span-1">
            <WeekCard drives={drives} sessions={sessions} now={now} />
          </div>
        </LoadingScope>
      </div>
    </section>
  );
}

/** What vehicle state's charger status says about the plug. */
function plugState(status: string | null): 'charging' | 'plugged' | null {
  if (status === 'chrgr_sts_connected_charging') return 'charging';
  return status?.startsWith('chrgr_sts_connected') ? 'plugged' : null;
}
