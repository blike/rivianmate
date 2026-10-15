import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type WallboxDto } from '../../api/client';
import { useChargingSessions, useLiveCharging, useVehicleState } from '../../api/hooks';
import { LoadingScope, SkeletonRows } from '../../components/LoadingState';
import { Panel } from '../../components/Panel';
import { isChargingLive, liveCharge } from '../../lib/liveCharge';
import { sv } from '../../lib/state';
import { CurveChart } from './CurveChart';
import { EnergySplit } from './EnergySplit';
import { LiveCard } from './LiveCard';
import { SchedulesPanel } from './SchedulesPanel';
import { SessionCard } from './SessionCard';
import { SessionList } from './SessionList';
import { SessionPicker } from './SessionPicker';
import { WallboxPanel } from './WallboxPanel';

export function ChargingPage(props: { vehicleId: string }) {
  const queryClient = useQueryClient();
  const { data: live } = useLiveCharging(props.vehicleId);
  const { data: state } = useVehicleState(props.vehicleId);

  const { data: sessions, isPending: sessionsPending } = useChargingSessions(props.vehicleId);

  const { data: wallboxes } = useQuery({
    queryKey: ['wallboxes'],
    queryFn: api.wallboxes,
    refetchInterval: 60_000,
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
    queryKey: ['chargingCurve', session?.id],
    queryFn: () => api.chargingCurve(session!.id),
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
        <ScheduleRow vehicleId={props.vehicleId} wallboxes={wallboxes} />
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
            onSaveCost={session ? saveCost(session.id) : undefined}
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
            loading={sessionsPending || (session != null && curvePending)}
            notStarted={
              session != null &&
              !session.endedAt &&
              session.chargingStartedAt == null &&
              session.chargingSince == null
            }
          />
          {session && (
            <EnergySplit
              packKwh={session.packKwh}
              thermalKwh={session.thermalKwh}
              inProgress={!session.endedAt}
            />
          )}
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

      <ScheduleRow vehicleId={props.vehicleId} wallboxes={wallboxes} />
    </div>
  );
}

/** Schedules, then any wallboxes beside them. */
function ScheduleRow(props: { vehicleId: string; wallboxes: WallboxDto[] | undefined }) {
  const wallboxes = props.wallboxes ?? [];
  return (
    <div
      className={`grid grid-cols-1 items-start gap-4 ${wallboxes.length ? 'lg:grid-cols-2' : ''}`}
    >
      <SchedulesPanel vehicleId={props.vehicleId} />
      {wallboxes.length > 0 && (
        <div className="grid grid-cols-1 gap-4">
          {wallboxes.map((wb) => (
            <WallboxPanel key={wb.wallboxId} wallbox={wb} />
          ))}
        </div>
      )}
    </div>
  );
}
