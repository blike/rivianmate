import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { isTeslaMateVehicle } from '@server/teslamate/ids';
import { api, type WallboxDto } from '../../api/client';
import { useChargingSessions, useLiveCharging, useVehicleState } from '../../api/hooks';
import { LoadingScope, SkeletonRows } from '../../components/LoadingState';
import { Panel } from '../../components/Panel';
import { lastChargedTo } from '../../lib/charging';
import { isChargingLive, liveCharge } from '../../lib/liveCharge';
import { sv } from '../../lib/state';
import { CurveChart } from './CurveChart';
import { EnergySplit } from './EnergySplit';
import { LiveCard } from './LiveCard';
import { SessionCard } from './SessionCard';
import { SessionList } from './SessionList';
import { SessionPicker } from './SessionPicker';
import { WallboxPanel } from './WallboxPanel';

export function ChargingPage(props: { vehicleId: string }) {
  const queryClient = useQueryClient();
  const { data: live } = useLiveCharging(props.vehicleId);
  const { data: state } = useVehicleState(props.vehicleId);

  const { data: sessions, isPending: sessionsPending } = useChargingSessions(props.vehicleId);
  // TeslaMate is read-only, and schedules and wallboxes are Rivian's.
  const teslamate = isTeslaMateVehicle(props.vehicleId);

  const { data: wallboxes } = useQuery({
    queryKey: ['wallboxes'],
    queryFn: api.wallboxes,
    refetchInterval: 60_000,
    enabled: !teslamate,
  });

  const costMutation = useMutation({
    mutationFn: ({ id, cost }: { id: number; cost: string | null }) =>
      api.updateSessionCost(id, cost),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['chargingSessions', props.vehicleId] }),
  });
  const saveCost = (id: number) => (cost: string | null) => costMutation.mutate({ id, cost });

  const isLive = isChargingLive(live);
  // The live session arrives over SSE just after the page loads; if the
  // vehicle state already says it's charging, hold its place meanwhile.
  const liveExpected =
    live === undefined && sv(state, 'chargerStatus') === 'chrgr_sts_connected_charging';

  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const session = sessions?.find((s) => s.id === selectedSessionId) ?? sessions?.[0];
  const showingOpen = session != null && !session.endedAt && session.id === sessions?.[0]?.id;

  const {
    data: curve,
    isPending: curvePending,
    isPlaceholderData: showingPreviousCurve,
  } = useQuery({
    queryKey: ['chargingCurve', props.vehicleId, session?.id],
    queryFn: () => api.chargingCurve(props.vehicleId, session!.id),
    enabled: session != null,
    refetchInterval: session && !session.endedAt ? 30_000 : false,
    // Keep the previous curve on screen (dimmed) while the next one loads.
    placeholderData: keepPreviousData,
  });

  if (!sessionsPending && !sessions?.length) {
    return (
      <div className="space-y-4">
        {(isLive || liveExpected) && <LiveCard live={live} loading={!isLive} state={state} />}
        <Panel title="Charging sessions">
          <p className="py-6 text-center text-sm text-(--text-muted)">
            No charging sessions recorded yet.
          </p>
        </Panel>
        {!teslamate && <Wallboxes wallboxes={wallboxes} />}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {sessions && sessions.length > 1 && (
        <SessionPicker
          sessions={sessions}
          selectedId={session?.id ?? null}
          onSelect={setSelectedSessionId}
        />
      )}
      <div className={`transition-opacity ${showingPreviousCurve ? 'opacity-50' : ''}`}>
        <LoadingScope loading={sessionsPending}>
          <SessionCard
            session={session}
            live={showingOpen ? liveCharge(isLive ? live : null, state) : null}
            lastChargedTo={lastChargedTo(sessions)}
            // A TeslaMate session's id is TeslaMate's, so its cost isn't RivianMate's to edit.
            onSaveCost={session && !teslamate ? saveCost(session.id) : undefined}
          />
        </LoadingScope>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel
          title="Charging curve"
          className={`transition-opacity ${showingPreviousCurve ? 'opacity-50' : ''}`}
        >
          <CurveChart
            curve={curve}
            limit={session?.socLimit}
            loading={sessionsPending || (session != null && curvePending)}
            notStarted={
              session != null &&
              !session.endedAt &&
              session.chargingStartedAt == null &&
              session.chargingSince == null
            }
          />
          {session && <EnergySplit session={session} />}
        </Panel>

        <Panel title="All sessions" className="hidden flex-col lg:flex">
          <div className="relative min-h-0 flex-1">
            <div className="-mx-4 max-h-112 overflow-auto lg:absolute lg:inset-0 lg:max-h-none">
              {sessionsPending ? (
                <div className="px-4">
                  <SkeletonRows rows={8} />
                </div>
              ) : (
                <SessionList
                  sessions={sessions!}
                  selectedId={session?.id ?? null}
                  onSelect={setSelectedSessionId}
                />
              )}
            </div>
          </div>
        </Panel>
      </div>

      {!teslamate && <Wallboxes wallboxes={wallboxes} />}
    </div>
  );
}

/** Any wallboxes, two to a row. */
function Wallboxes(props: { wallboxes: WallboxDto[] | undefined }) {
  if (!props.wallboxes?.length) return null;
  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
      {props.wallboxes.map((wb) => (
        <WallboxPanel key={wb.wallboxId} wallbox={wb} />
      ))}
    </div>
  );
}
