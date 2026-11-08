import { type ReactNode, useEffect, useState } from 'react';
import type { TripDetailDto } from '../../api/client';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  isNotFound,
  useAddTripActivities,
  useDeleteTrip,
  useRemoveTripActivity,
  useTrip,
  useTripRoute,
  useUpdateTrip,
} from '../../api/hooks';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Dialog } from '../../components/Dialog';
import { LoadingScope, SkeletonRows } from '../../components/LoadingState';
import { PageHeader } from '../../components/PageHeader';
import { Panel } from '../../components/Panel';
import { localKey } from '../../lib/drives';
import { placeName } from '../drives/format';
import { isRoundTrip, tripStays } from './insights';
import { TripBuilder } from './TripBuilder';
import { TripInsights } from './TripInsights';
import { TripMap } from './TripMap';
import { TripStats } from './TripStats';
import { type Removed, type Selection, TripTimeline } from './TripTimeline';
import { NightsLine } from './Stays';
import {
  type OpenPhase,
  daysBetween,
  openPhase,
  phaseLabel,
  tripDateLabel,
  sortedByStart,
} from './trips';

/** How long a removed drive or charge can be put back from the timeline. */
const UNDO_MS = 8000;

/** One journey: its figures, map and timeline. */
export function TripPage(props: { vehicleId: string }) {
  const { vehicleId } = props;
  const params = useParams();
  const tripId = Number(params.tripId);
  const navigate = useNavigate();
  const { data: trip, isPending, error, refetch, isRefetching } = useTrip(vehicleId, tripId);
  const phase = trip ? openPhase(trip) : null;
  const { data: route } = useTripRoute(vehicleId, tripId, phase?.kind === 'live');
  const update = useUpdateTrip(vehicleId, tripId);
  const remove = useDeleteTrip(vehicleId, tripId, () => void navigate('/trips', { replace: true }));
  const removeActivity = useRemoveTripActivity(vehicleId, tripId);
  const addBack = useAddTripActivities(vehicleId, tripId);
  const [removed, setRemoved] = useState<Removed | null>(null);
  useEffect(() => {
    if (!removed) return;
    const timer = setTimeout(() => setRemoved(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [removed]);
  const [dialog, setDialog] = useState<'edit' | 'delete' | null>(null);
  // The day Edit trip opens on, to find driving that isn't in the trip.
  const [editDay, setEditDay] = useState<string | null>(null);
  // Unsaved edits: a stray click outside the dialog mustn't throw them away.
  const [editDirty, setEditDirty] = useState(false);
  const [selected, setSelected] = useState<Selection>(null);

  const [focusDay, setFocusDay] = useState<string | null>(null);

  if (error && !trip && !isNotFound(error)) {
    return (
      <>
        <PageHeader title="Couldn’t load this trip" />
        <p className="text-sm text-(--text-muted)">
          {error.message}{' '}
          <button
            type="button"
            disabled={isRefetching}
            onClick={() => void refetch()}
            className="text-(--accent) hover:underline disabled:opacity-50"
          >
            Try again
          </button>
        </p>
      </>
    );
  }

  if (error && !trip) {
    return (
      <>
        <PageHeader title="Trip not found" />
        <p className="text-sm text-(--text-muted)">
          This trip doesn’t exist, or it’s another vehicle’s.{' '}
          <Link to="/trips" className="text-(--accent) hover:underline">
            See this vehicle’s trips
          </Link>
          .
        </p>
      </>
    );
  }

  return (
    <>
      <PageHeader
        kicker={
          <Link to="/trips" className="hover:underline">
            Trips
          </Link>
        }
        title={trip?.name ?? ' '}
        action={
          trip && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setEditDay(null);
                setDialog('edit');
              }}
            >
              Edit trip
            </button>
          )
        }
      />
      <div className="space-y-4">
        <LoadingScope loading={isPending}>
          <section className="card overflow-hidden">
            {trip && (
              <div className="p-5">
                <TripOutline
                  trip={trip}
                  phase={phase}
                  action={
                    // Under way and not already ending today. The end is a day,
                    // so what's driven later today still joins.
                    phase?.kind === 'live' &&
                    (trip.endDate == null || trip.endDate > localKey(new Date())) && (
                      <button
                        type="button"
                        className="btn-secondary"
                        title="Makes today its last day. Anything later today still joins."
                        disabled={update.isPending}
                        onClick={() =>
                          update.mutate({ name: trip.name, endDate: localKey(new Date()) })
                        }
                      >
                        End trip today
                      </button>
                    )
                  }
                />
                {trip.notes && (
                  <p className="mt-2 whitespace-pre-wrap text-sm text-(--text-secondary)">
                    {trip.notes}
                  </p>
                )}
                {trip.missing > 0 && (
                  <p className="mt-2 text-sm text-(--status-warning)">
                    {trip.missing} {trip.missing === 1 ? 'activity' : 'activities'} in this trip
                    can’t be read right now, so {trip.missing === 1 ? 'it’s' : 'they’re'} left out
                    below.
                  </p>
                )}
              </div>
            )}
            {trip && <TripStats stats={trip.stats} />}
          </section>
        </LoadingScope>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <section className="card relative h-104 overflow-hidden lg:h-[38rem]">
            <TripMap
              trip={trip}
              routes={route}
              selected={selected}
              onSelect={setSelected}
              focusDay={focusDay}
              onFocusDay={setFocusDay}
            />
          </section>
          <Panel title="Timeline" className="flex flex-col">
            <div className="relative min-h-0 flex-1">
              <div className="-mx-4 max-h-112 overflow-auto lg:absolute lg:inset-0 lg:max-h-none">
                {trip ? (
                  <TripTimeline
                    trip={trip}
                    selected={selected}
                    onSelect={setSelected}
                    onRemove={(kind, id) => {
                      setSelected(null);
                      const drive = kind === 'drive' && trip.drives.find((d) => d.id === id);
                      const session = kind === 'charge' && trip.sessions.find((s) => s.id === id);
                      setRemoved(
                        drive
                          ? { kind: 'drive', drive }
                          : session
                            ? { kind: 'charge', session }
                            : null,
                      );
                      removeActivity.mutate({ kind, id });
                    }}
                    removed={removed}
                    // Not until the removal's saved, or putting it back could land first.
                    onUndo={
                      removed && !removeActivity.isPending
                        ? () => {
                            addBack.mutate([
                              removed.kind === 'drive'
                                ? { kind: 'drive', id: removed.drive.id }
                                : { kind: 'charge', id: removed.session.id },
                            ]);
                            setRemoved(null);
                          }
                        : null
                    }
                    onFindMissing={(day) => {
                      setEditDay(day);
                      setDialog('edit');
                    }}
                  />
                ) : (
                  <div className="px-4">
                    <SkeletonRows rows={8} />
                  </div>
                )}
              </div>
            </div>
          </Panel>
        </div>

        {trip && (
          <TripInsights trip={trip} routes={route} focusDay={focusDay} onFocusDay={setFocusDay} />
        )}
      </div>

      {trip && (
        <>
          <Dialog
            open={dialog === 'edit'}
            title="Edit trip"
            wide
            fixedHeight
            dismissible={!editDirty}
            onClose={() => setDialog(null)}
          >
            <TripBuilder
              vehicleId={vehicleId}
              trip={trip}
              onDone={() => setDialog(null)}
              onDelete={() => setDialog('delete')}
              onDirtyChange={setEditDirty}
              scrollToDay={editDay}
            />
          </Dialog>
          <ConfirmDialog
            open={dialog === 'delete'}
            title={`Delete ${trip.name}?`}
            confirmLabel="Delete trip"
            busy={remove.isPending}
            onCancel={() => setDialog(null)}
            onConfirm={() => remove.mutate()}
          >
            Only the trip goes. Its drives and charges stay as they are.
          </ConfirmDialog>
        </>
      )}
    </>
  );
}

/**
 * When and where: the dates and where it set out from, and where it spent
 * its nights, in a line. A trip under way or to come leads with which day
 * it's on, or when it starts, and has room for an action beside it.
 */
function TripOutline(props: { trip: TripDetailDto; phase: OpenPhase | null; action?: ReactNode }) {
  const { trip, phase } = props;
  const first = sortedByStart(trip.drives)[0];
  const from = first?.start ? placeName(first.start) : null;
  const where = from && (isRoundTrip(trip.drives) ? `Round trip from ${from}` : `From ${from}`);
  const dates = tripDateLabel(trip) ?? 'No dates yet';
  const span = spanDays(trip);
  const stays = tripStays(trip.drives, trip.sessions);
  return (
    <>
      {phase ? (
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-(--accent)">
              {phase.kind === 'live' ? 'Active trip' : 'Upcoming trip'}
            </div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-2xl font-semibold tracking-tight tabular-nums">
                {phaseLabel(phase)}
              </span>
              <span className="text-sm text-(--text-secondary) tabular-nums">
                {[dates, where].filter(Boolean).join(' · ')}
              </span>
            </div>
          </div>
          {props.action}
        </div>
      ) : (
        <div className="text-sm text-(--text-secondary) tabular-nums">
          {[dates, span > 1 && `${span} days`, where].filter(Boolean).join(' · ')}
        </div>
      )}
      <NightsLine stays={stays} />
    </>
  );
}

/** Calendar days from the trip's first to its last, both included; 0 without dates. */
function spanDays(trip: TripDetailDto): number {
  const start = trip.startDate ?? (trip.stats.startedAt ? localKey(trip.stats.startedAt) : null);
  const end =
    trip.endDate ?? (trip.stats.lastStartedAt ? localKey(trip.stats.lastStartedAt) : null);
  return start && end && end >= start ? daysBetween(start, end) + 1 : 0;
}
