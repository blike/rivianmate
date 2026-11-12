import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { isTeslaMateVehicle } from '@server/teslamate/ids';
import { api, type WallboxDto } from '../../api/client';
import {
  useChargingCoverage,
  useChargingPages,
  useLiveCharging,
  usePackTemps,
  useVehicleState,
} from '../../api/hooks';
import { AddToTrip } from '../../components/AddToTrip';
import { DayCalendar } from '../../components/DayCalendar';
import { PageHeader } from '../../components/PageHeader';
import { LoadingScope, SkeletonRows } from '../../components/LoadingState';
import { LoadOlder } from '../../components/LoadOlder';
import { Panel } from '../../components/Panel';
import { lastChargedTo } from '../../lib/charging';
import { useGoToDate } from '../../lib/goToDate';
import { isChargingLive, liveCharge } from '../../lib/liveCharge';
import { sv } from '../../lib/state';
import { CurveChart } from './CurveChart';
import { EnergySplit } from './EnergySplit';
import { LiveCard } from './LiveCard';
import { SessionCard } from './SessionCard';
import { SessionList } from './SessionList';
import { SessionPicker } from './SessionPicker';
import { chargeEnd, chargeStart, notStarted } from './sessions';
import { WallboxPanel } from './WallboxPanel';

export function ChargingPage(props: { vehicleId: string }) {
  const queryClient = useQueryClient();
  const { data: live } = useLiveCharging(props.vehicleId);
  const { data: state } = useVehicleState(props.vehicleId);

  const pages = useChargingPages(props.vehicleId);
  const { items: sessions, isPending: sessionsPending } = pages;
  const older = { has: pages.hasOlder, loading: pages.loadingOlder, load: pages.loadOlder };
  const newer = {
    has: pages.hasNewer,
    loading: pages.loadingNewer,
    load: pages.loadNewer,
    // Back to the newest, and to showing it.
    latest: () => {
      pages.jumpTo(null);
      setSelectedSessionId(null);
    },
  };
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

  // Going to a date: a calendar of the month with each day's sessions, by
  // the day each started charging, as they're listed, back to the first.
  const { data: coverage } = useChargingCoverage(props.vehicleId);
  const goTo = useGoToDate({
    queryKey: ['chargingSessions', props.vehicleId],
    fetchWindow: (from, to) => api.chargingSessions(props.vehicleId, { from, to }),
    listed: sessions,
    jumpTo: pages.jumpTo,
    selected: session,
    onSelect: setSelectedSessionId,
    dayOf: chargeStart,
    earliest: coverage?.since ? new Date(coverage.since) : null,
  });
  const calendar = <DayCalendar noun="session" {...goTo.calendar} />;
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
    // Keep the previous curve on screen (dimmed) while the next one loads,
    // unless it was hidden because that session hadn't started charging.
    placeholderData: (previous, previousQuery) => {
      const shown = sessions?.find((s) => s.id === previousQuery?.queryKey[2]);
      return shown && notStarted(shown) ? undefined : previous;
    },
  });

  // The pack's own temperature through the charge, which is what a slow one is
  // usually down to. It is recorded apart from the curve, as state history, and
  // read as the same banded series the drive page draws.
  const { data: temperatures } = usePackTemps(
    props.vehicleId,
    session && { id: session.id, from: chargeStart(session), to: chargeEnd(session) },
  );

  if (!sessionsPending && !sessions?.length) {
    return (
      <>
        <PageHeader title="Charging" />
        <div className="space-y-4">
          {(isLive || liveExpected) && <LiveCard live={live} loading={!isLive} state={state} />}
          <Panel title="Charging sessions">
            <p className="py-6 text-center text-sm text-(--text-muted)">
              No charging sessions recorded yet.
            </p>
          </Panel>
          {!teslamate && <Wallboxes wallboxes={wallboxes} />}
        </div>
      </>
    );
  }

  return (
    <>
      {/* Until the list shows beside the details, the calendar sits at the header's
          right, so the picker has the width. */}
      <PageHeader title="Charging" action={<div className="lg:hidden">{calendar}</div>} />
      <div className="space-y-4">
        {sessions && sessions.length > 1 && (
          <SessionPicker
            sessions={sessions}
            selectedId={session?.id ?? null}
            onSelect={setSelectedSessionId}
            older={older}
            newer={newer}
            className="sticky top-2 z-20 lg:hidden"
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
              action={
                session?.endedAt ? (
                  <AddToTrip
                    vehicleId={props.vehicleId}
                    kind="charge"
                    activityId={session.id}
                    startedAt={chargeStart(session)}
                  />
                ) : undefined
              }
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
              temperatures={temperatures}
              limit={session?.socLimit}
              loading={sessionsPending || (session != null && curvePending)}
              notStarted={session != null && notStarted(session)}
            />
            {session && <EnergySplit session={session} />}
          </Panel>

          <Panel title="All sessions" className="hidden flex-col lg:flex" action={calendar}>
            <div className="relative min-h-0 flex-1">
              <div
                className={`-mx-4 max-h-112 overflow-auto transition-opacity lg:absolute lg:inset-0 lg:max-h-none ${
                  pages.moving ? 'opacity-50' : ''
                }`}
              >
                {sessionsPending ? (
                  <div className="px-4">
                    <SkeletonRows rows={8} />
                  </div>
                ) : (
                  <>
                    <SessionList
                      sessions={sessions!}
                      selectedId={session?.id ?? null}
                      onSelect={setSelectedSessionId}
                      revealId={goTo.revealId}
                      onRevealed={goTo.clearReveal}
                      newer={newer}
                    />
                    {older.has && (
                      <LoadOlder
                        label="Show older sessions"
                        loading={older.loading}
                        onLoad={older.load}
                      />
                    )}
                  </>
                )}
              </div>
            </div>
          </Panel>
        </div>

        {!teslamate && <Wallboxes wallboxes={wallboxes} />}
      </div>
    </>
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
