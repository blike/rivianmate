import { useEffect, useState } from 'react';
import { useChargingSessions, useDrives, useInsights, useVehicleState } from '../../api/hooks';
import { LoadingScope } from '../../components/LoadingState';
import { nv } from '../../lib/state';
import { LastChargeCard } from './LastChargeCard';
import { LastDriveCard } from './LastDriveCard';
import { SectionHeading } from './SectionHeading';

/** Last drive and last charge, each linking to its page. */
export function RecentActivity(props: { vehicleId: string }) {
  const { data: drives, isPending: drivesPending } = useDrives(props.vehicleId);
  const { data: state } = useVehicleState(props.vehicleId);
  const { data: sessions, isPending: sessionsPending } = useChargingSessions(props.vehicleId);
  const { data: insights } = useInsights(props.vehicleId);
  // Keeps "2 h ago" and a live drive's duration current.
  const driving = drives?.[0] != null && !drives[0].endedAt;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), driving ? 15_000 : 60_000);
    return () => clearInterval(t);
  }, [driving]);

  return (
    <section>
      <SectionHeading>Recent activity</SectionHeading>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <LoadingScope loading={drivesPending}>
          <LastDriveCard
            drive={drives?.[0]}
            now={now}
            speedMps={nv(state, 'gnssSpeed')}
            navigation={insights?.navigation}
          />
        </LoadingScope>
        <LoadingScope loading={sessionsPending}>
          <LastChargeCard session={sessions?.[0]} now={now} />
        </LoadingScope>
      </div>
    </section>
  );
}
