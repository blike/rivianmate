import { type ReactNode, useState } from 'react';
import { Link } from 'react-router-dom';
import type { TripSummaryDto } from '../../api/client';
import { useTrips, useUnits } from '../../api/hooks';
import { Dialog } from '../../components/Dialog';
import { Skeleton } from '../../components/LoadingState';
import { PageHeader } from '../../components/PageHeader';
import { plural } from '../../lib/format';
import { fmt, fmtSeconds } from '../../lib/state';
import { localKey } from '../../lib/drives';
import { TripBuilder } from './TripBuilder';
import { PhaseBadge } from './PhaseBadge';
import {
  type OpenPhase,
  costsLabel,
  openPhase,
  tripCalendar,
  tripDateLabel,
  dayLabel,
} from './trips';

/** The vehicle's journeys: any under way up top, then those to come, then those done. */
export function TripsPage(props: { vehicleId: string }) {
  const { data: trips, isPending, isError } = useTrips(props.vehicleId);
  const [creating, setCreating] = useState(false);
  const today = localKey(new Date());
  const phases = new Map(trips?.map((t) => [t.id, openPhase(t, today)]));
  const live = trips?.filter((t) => phases.get(t.id)?.kind === 'live') ?? [];
  const upcoming = (trips?.filter((t) => phases.get(t.id)?.kind === 'upcoming') ?? []).sort(
    (a, b) => a.startDate!.localeCompare(b.startDate!),
  );
  const completed = trips?.filter((t) => phases.get(t.id) == null) ?? [];
  // Headings only once there's more than one kind of trip to tell apart.
  const headed = [live, upcoming, completed].filter((g) => g.length > 0).length > 1;

  return (
    <>
      <PageHeader
        title="Trips"
        action={
          <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
            New trip
          </button>
        }
      />
      {isPending ? (
        <ul aria-busy aria-label="Loading trips" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {Array.from({ length: 2 }, (_, i) => (
            <TripCardSkeleton key={i} />
          ))}
        </ul>
      ) : isError ? (
        <EmptyCard>Couldn’t load trips.</EmptyCard>
      ) : trips.length === 0 ? (
        <EmptyCard>
          No trips yet.
          <span className="mt-1 block text-(--text-muted)">
            A trip gathers a journey’s drives and charges, with its route and totals.
          </span>
        </EmptyCard>
      ) : (
        <div className="space-y-6">
          {live.length > 0 && (
            <section aria-label="Active" className="space-y-3">
              {/* Always headed: the badge says only which day it is. */}
              <h2 className="eyebrow text-(--accent)">Active</h2>
              <div className="space-y-4">
                {live.map((trip) => (
                  <LiveTripCard key={trip.id} trip={trip} phase={phases.get(trip.id)!} />
                ))}
              </div>
            </section>
          )}
          {[
            { title: 'Upcoming', group: upcoming },
            { title: 'Completed', group: completed },
          ].map(
            ({ title, group }) =>
              group.length > 0 && (
                <section key={title} aria-label={title}>
                  {headed && <h2 className="eyebrow mb-3">{title}</h2>}
                  <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    {group.map((trip) => (
                      <TripCard key={trip.id} trip={trip} phase={phases.get(trip.id) ?? null} />
                    ))}
                  </ul>
                </section>
              ),
          )}
        </div>
      )}
      <Dialog open={creating} title="New trip" wide fixedHeight onClose={() => setCreating(false)}>
        <TripBuilder vehicleId={props.vehicleId} onDone={() => setCreating(false)} />
      </Dialog>
    </>
  );
}

/**
 * A trip under way: a trip card at full width, its figures large and to the
 * side, as they move while it's driven.
 */
function LiveTripCard(props: { trip: TripSummaryDto; phase: OpenPhase }) {
  const u = useUnits();
  const { trip } = props;
  const s = trip.stats;
  const empty = s.drives + s.charges === 0;
  const costs = costsLabel(s.costs, { marked: false });
  return (
    <Link
      to={`/trips/${trip.id}`}
      className="card card-link card-link--live flex flex-wrap items-center gap-x-8 gap-y-5 p-5"
    >
      <div className="flex min-w-0 flex-[1_1_20rem] items-center gap-4">
        <CalendarPage calendar={tripCalendar(trip)} />
        <div className="min-w-0">
          <PhaseBadge phase={props.phase} />
          <h2 className="mt-2 truncate text-xl font-semibold tracking-tight lg:text-2xl">
            {trip.name}
          </h2>
          <p className="mt-0.5 truncate text-sm text-(--text-secondary) tabular-nums">
            {[
              tripDateLabel(trip),
              s.drives > 0 && plural(s.drives, 'drive'),
              s.charges > 0 && plural(s.charges, 'charge'),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      </div>
      {!empty && (
        <div className="grid w-full grid-cols-2 gap-x-8 gap-y-4 tabular-nums sm:flex sm:w-auto sm:gap-10">
          <Figure
            large
            label="distance"
            value={s.drivesWithDistance > 0 ? u.formatDistance(s.distanceKm) : '—'}
          />
          <Figure large label="driving" value={s.drives > 0 ? fmtSeconds(s.drivingSeconds) : '—'} />
          <Figure
            large
            label="efficiency"
            value={
              s.efficiency
                ? u.formatEfficiency(s.efficiency.distanceKm, s.efficiency.energyKwh)
                : '—'
            }
          />
          {costs ? (
            <Figure large label="charging" value={costs} />
          ) : (
            <Figure
              large
              label="charged"
              value={s.chargesWithEnergy > 0 ? `${fmt(s.energyAddedKwh, 1)} kWh` : '—'}
            />
          )}
        </div>
      )}
    </Link>
  );
}

function TripCard(props: { trip: TripSummaryDto; phase: OpenPhase | null }) {
  const u = useUnits();
  const { trip, phase } = props;
  const { stats } = trip;
  const empty = stats.drives + stats.charges === 0;
  const calendar = tripCalendar(trip);
  const costs = costsLabel(stats.costs, { marked: false });
  return (
    <li>
      <Link to={`/trips/${trip.id}`} className="card card-link flex items-center gap-4 p-4">
        <CalendarPage calendar={calendar} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="min-w-0 truncate text-base font-semibold tracking-tight lg:text-xl">
              {trip.name}
            </h2>
            {phase && <PhaseBadge phase={phase} />}
          </div>
          {empty ? (
            <p className="mt-1 text-sm text-(--text-secondary)">
              {phase?.kind === 'upcoming' && trip.startDate
                ? `Drives join from ${dayLabel(trip.startDate)}`
                : 'Nothing added yet'}
            </p>
          ) : (
            <div className="mt-1.5 flex gap-5 tabular-nums">
              <Figure
                label={plural(stats.drives, 'drive')}
                value={stats.drivesWithDistance > 0 ? u.formatDistance(stats.distanceKm) : '—'}
              />
              <Figure
                label="driving"
                value={stats.drives > 0 ? fmtSeconds(stats.drivingSeconds) : '—'}
              />
              {stats.efficiency && (
                <Figure
                  label="efficiency"
                  value={u.formatEfficiency(
                    stats.efficiency.distanceKm,
                    stats.efficiency.energyKwh,
                  )}
                />
              )}
              {stats.charges > 0 &&
                (costs ? (
                  <Figure label="charging" value={costs} />
                ) : (
                  <Figure
                    label="charged"
                    value={
                      stats.chargesWithEnergy > 0 ? `${fmt(stats.energyAddedKwh, 1)} kWh` : '—'
                    }
                  />
                ))}
            </div>
          )}
        </div>
      </Link>
    </li>
  );
}

/** A message in place of the list, unheaded: the page's title already says what it's of. */
function EmptyCard(props: { children: ReactNode }) {
  return (
    <section className="card px-5 py-11 text-center text-sm text-(--text-secondary)">
      {props.children}
    </section>
  );
}

/** A card's figure: the value large, what it is beneath. */
function Figure(props: { label: string; value: string; large?: boolean }) {
  return (
    <div className="min-w-0">
      <div
        className={`truncate leading-tight font-semibold ${
          props.large ? 'text-2xl tracking-tight' : 'text-base lg:text-lg'
        }`}
      >
        {props.value}
      </div>
      <div className="mt-0.5 truncate text-xs text-(--text-muted)">{props.label}</div>
    </div>
  );
}

/** One size for every calendar page, whatever the dates, so the cards line up. */
const CALENDAR = 'h-[4.5rem] w-20 shrink-0 rounded-lg';

/** The trip's dates as a tear-off calendar page. */
function CalendarPage(props: { calendar: ReturnType<typeof tripCalendar> }) {
  const c = props.calendar;
  return (
    <div
      aria-label={c ? undefined : 'No dates yet'}
      className={`${CALENDAR} flex flex-col overflow-hidden border border-(--border) bg-(--surface-2) text-center`}
    >
      <div
        className={`h-4.5 shrink-0 truncate px-1 text-[10px] leading-4.5 font-semibold tracking-wide uppercase ${
          c ? 'bg-(--accent) text-(--on-accent)' : 'bg-(--surface-3)'
        }`}
      >
        {c?.month}
      </div>
      {/* A range sets smaller than a single day, in the same space. */}
      <div
        className={`flex min-h-0 flex-1 items-center justify-center px-1 leading-none font-semibold tracking-tight tabular-nums ${
          (c?.days.length ?? 0) > 3 ? 'text-xl' : 'text-[1.75rem]'
        }`}
      >
        {c?.days ?? <span className="text-(--text-muted)">—</span>}
      </div>
      <div className="h-4.5 shrink-0 text-[11px] leading-4 text-(--text-muted) tabular-nums">
        {c?.year ?? ''}
      </div>
    </div>
  );
}

/** A trip card's shape while the trips load. */
function TripCardSkeleton() {
  return (
    <li aria-hidden className="card flex items-center gap-4 p-4">
      <div className={`${CALENDAR} skeleton skeleton-block`} />
      <div className="min-w-0 flex-1">
        <div className="text-base lg:text-xl">
          <Skeleton className="w-[10em]" />
        </div>
        <div className="mt-1.5 text-base lg:text-lg">
          <Skeleton className="w-[12em]" />
        </div>
        <div className="text-xs">
          <Skeleton className="w-[14em]" />
        </div>
      </div>
    </li>
  );
}
