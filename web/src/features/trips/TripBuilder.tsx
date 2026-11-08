import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TripActivityRef, TripDetailDto } from '../../api/client';
import { useSaveTrip, useTripCandidates, useTrips, useUnits, useUpdateTrip } from '../../api/hooks';
import { Skeleton } from '../../components/LoadingState';
import { groupByDay, localKey } from '../../lib/drives';
import { chargerLabel } from '../../lib/charging';
import { browserTimeZone, clock, plural } from '../../lib/format';
import { fmt, fmtSeconds } from '../../lib/state';
import { driveTitle } from '../drives/format';
import { chargeStart } from '../charging/sessions';
import { suggestedName } from './insights';
import { TripDateField } from './TripDateField';
import {
  type BuilderRow,
  NO_PICKS,
  activityKey,
  addDays,
  chosenKeys,
  dayEnd,
  dayStart,
  daysBetween,
  homecoming,
  otherTrip,
  outsideDates,
  overlappingTrip,
  rowsBetween,
  toggleRow,
  byStart,
  dayLabel,
} from './trips';

/** How far past the start the list looks for the way home, before an end is picked. */
const LOOKAHEAD_DAYS = 30;
/** Begun this recently and not home yet, a trip is taken to be under way. */
const RECENT_DAYS = 14;

const field = 'field mt-1 block w-full font-normal';
const sectionLabel = 'text-xs font-medium tracking-wide text-(--text-muted) uppercase';

type Row = BuilderRow & {
  title: string;
  detail: string;
  /** The other trip it's in. */
  other: string | null;
  inTrip: boolean;
};

/** A trip's dates as it has them: set by hand, or taken from what's in it. */
function tripSpan(trip: TripDetailDto | undefined): { from: string; to: string | null } {
  if (!trip) return { from: '', to: null };
  const first = trip.stats.startedAt ? localKey(trip.stats.startedAt) : '';
  const last = trip.stats.lastStartedAt ? localKey(trip.stats.lastStartedAt) : null;
  // Under way with no end, it has none to show.
  if (trip.startDate && !trip.endDate) return { from: trip.startDate, to: null };
  return { from: trip.startDate ?? first, to: trip.endDate ?? last };
}

/**
 * Makes or edits a trip, which is its dates: everything that starts within
 * them is in it unless unticked, and what's driven later within them joins on
 * its own. Pick the day it started and the end follows the way home; a trip
 * that hasn't started, or hasn't come home yet, runs on with no end until it's
 * ended. Editing, the name and notes come first, and what's in the trip comes
 * ticked beside the rest of its days.
 */
export function TripBuilder(props: {
  vehicleId: string;
  trip?: TripDetailDto;
  onDone: () => void;
  /** Editing: offers to delete the trip. */
  onDelete?: () => void;
  /** Whether closing now would lose changes. */
  onDirtyChange?: (dirty: boolean) => void;
  /** A day to open the list at, YYYY-MM-DD: to find something not in the trip. */
  scrollToDay?: string | null;
}) {
  const { vehicleId, trip, onDirtyChange } = props;
  const u = useUnits();
  const navigate = useNavigate();
  const today = localKey(new Date());
  // As it was when the dialog opened: an open trip refreshes underneath.
  const [initial] = useState(() => tripSpan(trip));
  const [from, setFrom] = useState(initial.from);
  // The end picked, if any; one before the start doesn't stand.
  const [end, setEnd] = useState<string | null>(initial.to);
  // Ticked or unticked by hand; null leaves it to the dates.
  const [noEnd, setNoEnd] = useState<boolean | null>(trip ? initial.to == null : null);
  const [picks, setPicks] = useState(NO_PICKS);
  const [name, setName] = useState<string | null>(trip?.name ?? null);
  const [notes, setNotes] = useState(trip?.notes ?? '');
  const [createdId, setCreatedId] = useState<number | null>(null);

  const pickedTo = end && end >= from ? end : null;
  const upcoming = from !== '' && from > today;
  const ahead = from ? addDays(from, LOOKAHEAD_DAYS) : today;
  const windowEnd = [pickedTo ?? from, ahead < today ? ahead : today].sort().at(-1)!;
  const { data, isPending, isError, isPlaceholderData } = useTripCandidates(
    vehicleId,
    dayStart(from || today),
    dayEnd(windowEnd),
    from !== '' && !upcoming,
    trip?.id,
  );
  const loading = isPending || isPlaceholderData;
  const save = useSaveTrip(vehicleId);
  const tripId = trip?.id ?? -1;

  const all = useMemo<Row[]>(() => {
    if (!data) return [];
    const inThisTrip = (r: TripActivityRef) =>
      data.assignments.some(
        (a) => a.kind === r.kind && a.activityId === r.id && a.tripId === tripId,
      );
    const takenOut = (r: TripActivityRef) =>
      data.excluded.some((e) => e.kind === r.kind && e.id === r.id);
    const row = (ref: TripActivityRef, startedAt: string) => {
      const other = otherTrip(data.assignments, ref, tripId)?.tripName ?? null;
      const inTrip = inThisTrip(ref);
      return {
        ref,
        startedAt,
        other,
        inTrip,
        // Comes unticked: in another trip, or taken out of this one.
        assigned: other != null || (!inTrip && takenOut(ref)),
      };
    };
    return [
      ...data.drives.map((d) => ({
        ...row({ kind: 'drive', id: d.id }, d.startedAt),
        startsHome: d.start?.isHome ?? false,
        endsHome: d.end?.isHome ?? false,
        distanceKm: d.distanceKm,
        title: driveTitle(d),
        detail: u.formatDistance(d.distanceKm),
      })),
      ...data.sessions.map((s) => {
        const kwh = s.energyKwh ?? s.estimatedEnergyKwh;
        return {
          // When it charged, as on the charging page, not when it was plugged in.
          ...row({ kind: 'charge', id: s.id }, chargeStart(s)),
          startsHome: null,
          endsHome: null,
          distanceKm: null,
          title: `Charge at ${chargerLabel(s)}`,
          detail: [
            kwh != null && `${fmt(kwh, 1)} kWh`,
            s.chargingSeconds != null && fmtSeconds(s.chargingSeconds),
          ]
            .filter(Boolean)
            .join(' · '),
        };
      }),
    ].sort(byStart);
  }, [data, tripId, u]);

  // Until an end is picked, the trip runs to the day it came home. One that
  // hasn't started, began today, or set out lately and isn't back, is under way.
  const cameHome =
    from && !upcoming && pickedTo == null && noEnd !== true ? homecoming(all, from) : null;
  const ongoing =
    from !== '' &&
    (noEnd ??
      (upcoming ||
        (pickedTo == null &&
          (from === today ||
            (!loading && cameHome == null && daysBetween(from, today) <= RECENT_DAYS)))));
  const endDate = ongoing ? null : (pickedTo ?? cameHome ?? (from || null));
  // Outlined in either calendar: the days the trip has so far.
  const span = from && endDate ? { from, to: endDate } : null;
  const listTo = endDate == null || endDate > today ? (today > from ? today : from) : endDate;
  const rows = useMemo(
    () => (from && !upcoming ? rowsBetween(all, from, listTo) : []),
    [all, from, listTo, upcoming],
  );
  const chosen = useMemo(() => chosenKeys(rows, picks), [rows, picks]);
  const picked = rows.filter((r) => chosen.has(activityKey(r.ref)));
  const drives = data?.drives.filter((d) => chosen.has(activityKey({ kind: 'drive', id: d.id })));
  const distance = picked.reduce((sum, r) => sum + (r.distanceKm ?? 0), 0);
  const driveCount = picked.filter((r) => r.ref.kind === 'drive').length;
  const chargeCount = picked.length - driveCount;
  const shownName = name ?? suggestedName(drives ?? []) ?? '';

  // What saving does to what's in the trip.
  const toAdd = picked.filter((r) => !r.inTrip);
  const toRemove = rows.filter((r) => r.inTrip && !chosen.has(activityKey(r.ref)));
  // In the trip, but outside the dates it's being given. Only when they
  // change: one put in by hand outside the dates it has stays.
  const datesChanged = from !== initial.from || endDate !== initial.to;
  const outside = useMemo<TripActivityRef[]>(() => {
    if (!trip || !from || !datesChanged) return [];
    const out = (at: string) => outsideDates(at, { startDate: from, endDate });
    return [
      ...trip.drives
        .filter((d) => out(d.startedAt))
        .map((d) => ({ kind: 'drive' as const, id: d.id })),
      ...trip.sessions
        .filter((s) => out(chargeStart(s)))
        .map((s) => ({ kind: 'charge' as const, id: s.id })),
    ];
  }, [trip, from, endDate, datesChanged]);
  // Unticked and in no trip: kept out, so the trip doesn't take them in later.
  const keptOut = rows.filter(
    (r) => r.other == null && !r.inTrip && !chosen.has(activityKey(r.ref)),
  );

  const dirty = trip
    ? shownName.trim() !== trip.name ||
      notes.trim() !== (trip.notes ?? '') ||
      datesChanged ||
      toAdd.length + toRemove.length + outside.length > 0
    : from !== '';
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  // Another trip on any of these days would take what's driven on it.
  const { data: trips } = useTrips(vehicleId);
  const ownId = trip?.id ?? createdId;
  const clash = from ? overlappingTrip(trips ?? [], { id: ownId, startDate: from, endDate }) : null;
  const endOther = useUpdateTrip(vehicleId, clash?.id ?? -1);
  // The way out: end whichever starts first the day before the other.
  const fix = !clash?.startDate
    ? null
    : clash.startDate < from
      ? {
          label: `End ${clash.name} on ${dayLabel(addDays(from, -1))}`,
          apply: () => endOther.mutate({ name: clash.name, endDate: addDays(from, -1) }),
        }
      : from < clash.startDate
        ? {
            label: `End this trip on ${dayLabel(addDays(clash.startDate, -1))}`,
            apply: () => {
              setEnd(addDays(clash.startDate!, -1));
              setNoEnd(false);
            },
          }
        : null;

  const busy = save.isPending || endOther.isPending;
  const error = save.error ?? endOther.error;

  const submit = async () => {
    const id = await save.mutateAsync({
      // Once made, trying again after an error saves to it, not to a second trip.
      tripId: trip?.id ?? createdId,
      fields: {
        name: shownName.trim(),
        ...(trip && { notes: notes.trim() || null }),
        startDate: from,
        endDate,
        // Its days are counted where they were first set, wherever it's edited.
        timeZone: trip?.timeZone ?? browserTimeZone(),
      },
      add: (trip ? toAdd : picked).map((r) => r.ref),
      move: picked.some((r) => r.other != null),
      exclude: keptOut.map((r) => r.ref),
      remove: [...toRemove.map((r) => r.ref), ...outside],
      onCreated: setCreatedId,
    });
    // One still to come has nothing to show yet; it waits in the list.
    if (!trip && !upcoming) void navigate(`/trips/${id}`);
    props.onDone();
  };

  const days = groupByDay(rows);
  // Once, as soon as that day's rows are there. The list scrolls, not the dialog.
  const listRef = useRef<HTMLDivElement>(null);
  const scrolledTo = useRef<string | null>(null);
  const scrollToDay = props.scrollToDay;
  useEffect(() => {
    const list = listRef.current;
    if (!scrollToDay || loading || !list || scrolledTo.current === scrollToDay) return;
    const section = list.querySelector(`[data-day="${scrollToDay}"]`);
    if (!section) return;
    list.scrollTop += section.getBoundingClientRect().top - list.getBoundingClientRect().top;
    scrolledTo.current = scrollToDay;
  }, [scrollToDay, loading, days.length]);
  const canSubmit =
    !busy &&
    from !== '' &&
    !clash &&
    shownName.trim() !== '' &&
    (trip ? dirty : picked.length > 0 || ongoing || upcoming);
  // Ticking all leaves other trips' activities alone.
  const free = rows.filter((r) => r.other == null);
  const allOn = free.length > 0 && free.every((r) => chosen.has(activityKey(r.ref)));
  const nameField = (
    <label className="block text-sm font-medium">
      Name
      <input
        value={shownName}
        maxLength={120}
        placeholder="Name your trip"
        disabled={!trip && !from}
        onChange={(e) => setName(e.target.value)}
        className={field}
      />
    </label>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {trip && (
        <div className="space-y-3">
          {nameField}
          <label className="block text-sm font-medium">
            Notes
            {/* A few lines high, scrolling past them: the dialog keeps its size. */}
            <textarea
              value={notes}
              maxLength={5000}
              rows={3}
              placeholder="Optional"
              onChange={(e) => setNotes(e.target.value)}
              className={`${field} resize-none overflow-y-auto`}
            />
          </label>
        </div>
      )}

      <fieldset>
        <legend className={`${sectionLabel} mb-2`}>When</legend>
        {/* Positioned, so either field's calendar can take the row's width. */}
        <div className="relative grid grid-cols-2 gap-3">
          <TripDateField
            vehicleId={vehicleId}
            tripId={trip?.id}
            label="Start"
            value={from}
            placeholder="Pick a day"
            range={span}
            align="left"
            onPick={(start) => {
              setFrom(start);
              // An end before the new start no longer stands.
              if (end && end < start) setEnd(null);
              // A new trip works out its end again from the new start.
              if (!trip) setNoEnd(null);
            }}
          />
          <div>
            <TripDateField
              vehicleId={vehicleId}
              tripId={trip?.id}
              label="End"
              value={ongoing ? '' : (endDate ?? '')}
              placeholder={ongoing ? 'No end yet' : 'Pick a day'}
              near={from}
              minKey={from || undefined}
              range={span}
              disabled={!from || ongoing}
              align="right"
              onPick={(day) => {
                setEnd(day);
                setNoEnd(false);
              }}
            />
            <label className="mt-1.5 flex w-fit cursor-pointer items-center gap-2 text-xs text-(--text-secondary)">
              <input
                type="checkbox"
                checked={ongoing}
                disabled={!from}
                onChange={(e) => {
                  setNoEnd(e.target.checked);
                  setEnd(null);
                }}
                className="size-3.5 accent-(--accent)"
              />
              No end date yet
            </label>
          </div>
        </div>
        {clash && (
          <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
            <span className="text-(--status-warning)">Overlaps {clash.name}.</span>
            {fix && (
              <button
                type="button"
                disabled={busy}
                className="text-(--accent) hover:underline disabled:opacity-50"
                onClick={fix.apply}
              >
                {fix.label}
              </button>
            )}
          </p>
        )}
      </fieldset>

      <section className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className={sectionLabel}>Included</h3>
          <span className="truncate text-xs text-(--text-secondary) tabular-nums">
            {!from || upcoming ? null : loading ? (
              <Skeleton className="w-[12em]" />
            ) : (
              [
                picked.length === 0 && 'Nothing ticked',
                driveCount > 0 && plural(driveCount, 'drive'),
                chargeCount > 0 && plural(chargeCount, 'charge'),
                distance > 0 && u.formatDistance(distance),
              ]
                .filter(Boolean)
                .join(' · ')
            )}
          </span>
        </div>
        <div
          ref={listRef}
          className="min-h-32 flex-1 overflow-auto rounded-md border border-(--border)"
        >
          {!from ? (
            <p className="p-6 text-center text-sm text-(--text-muted)">Pick a start date.</p>
          ) : upcoming ? (
            <p className="p-6 text-center text-sm text-(--text-muted)">Nothing yet.</p>
          ) : isPending ? (
            <ListSkeleton />
          ) : isError ? (
            <p className="p-6 text-center text-sm text-(--text-muted)">Couldn’t load activities.</p>
          ) : days.length === 0 ? (
            <p className="p-6 text-center text-sm text-(--text-muted)">
              {ongoing ? 'Nothing yet.' : 'No drives or charges on these days.'}
            </p>
          ) : (
            days.map((d) => (
              // The last window's rows stay, faded and still, until the new one's arrive.
              <section
                key={d.key}
                data-day={d.key}
                aria-busy={isPlaceholderData || undefined}
                className={`transition-opacity ${isPlaceholderData ? 'pointer-events-none opacity-50' : ''}`}
              >
                <h4 className="sticky top-0 z-10 border-b border-(--border) bg-(--surface-1) px-3 py-1.5 text-xs font-medium tracking-wide text-(--text-muted) uppercase">
                  {d.label}
                </h4>
                <ul>
                  {d.items.map((r) => (
                    <ActivityRow
                      key={activityKey(r.ref)}
                      row={r}
                      on={chosen.has(activityKey(r.ref))}
                      onToggle={(on) => setPicks(toggleRow(picks, r, on))}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
        <div className="flex min-h-4 items-center justify-between gap-3 text-xs">
          <span className="text-(--status-warning)">
            {trip && changeNote(toAdd.length, toRemove.length, outside.length)}
          </span>
          {from && !loading && free.length > 1 && (
            <button
              type="button"
              className="shrink-0 text-(--text-muted) hover:text-(--text-primary)"
              onClick={() => setPicks(free.reduce((p, r) => toggleRow(p, r, !allOn), picks))}
            >
              {allOn ? 'Untick all' : 'Tick all'}
            </button>
          )}
        </div>
      </section>

      {!trip && nameField}
      {error && <p className="text-sm text-(--status-critical)">{error.message}</p>}
      <div className="flex items-center gap-2">
        {props.onDelete && (
          <button type="button" className="btn-danger" onClick={props.onDelete}>
            Delete trip
          </button>
        )}
        <button type="button" className={`btn-secondary ml-auto`} onClick={props.onDone}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={!canSubmit}
          onClick={() => void submit().catch(() => {})}
        >
          {trip ? 'Save' : 'Create trip'}
        </button>
      </div>
    </div>
  );
}

function ActivityRow(props: { row: Row; on: boolean; onToggle: (on: boolean) => void }) {
  const { row: r, on } = props;
  return (
    <li>
      <label className="flex cursor-pointer items-start gap-3 px-3 py-2 hover:bg-(--surface-2)">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => props.onToggle(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-(--accent)"
        />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm ${on ? '' : 'text-(--text-muted)'}`}>
            {r.title}
          </span>
          <span className="block truncate text-xs text-(--text-muted) tabular-nums">
            {[clock(r.startedAt), r.detail].filter(Boolean).join(' · ')}
          </span>
          {r.other && (
            <span className="block text-xs text-(--status-warning)">
              {on ? `Moves here from ${r.other}` : `In ${r.other}`}
            </span>
          )}
          {r.inTrip && !on && (
            <span className="block text-xs text-(--status-warning)">Comes out of this trip</span>
          )}
        </span>
      </label>
    </li>
  );
}

/** Title widths for the placeholder rows, so they read as a list, not a block. */
const SKELETON_TITLES = ['14em', '18em', '11em', '16em', '12em', '17em'];

/** The list's shape while it loads: a day's header over rows of checkbox, title and detail. */
function ListSkeleton() {
  return (
    <div aria-busy aria-label="Loading drives and charges">
      <div className="border-b border-(--border) bg-(--surface-1) px-3 py-1.5 text-xs">
        <Skeleton className="w-[7em]" />
      </div>
      <ul aria-hidden>
        {SKELETON_TITLES.map((width, i) => (
          <li key={i} className="flex items-start gap-3 px-3 py-2">
            <span className="skeleton mt-0.5 block size-4 shrink-0 rounded-[3px]" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm">
                <Skeleton style={{ width }} />
              </span>
              <span className="block text-xs">
                <Skeleton className="w-[7em]" />
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "Saving adds 2 and removes 1.": what saving does to what's in the trip. */
function changeNote(adding: number, removing: number, outside: number): string | null {
  const parts = [
    adding > 0 && `adds ${adding}`,
    removing > 0 && `removes ${removing}`,
    outside > 0 && `removes ${outside} outside the new dates`,
  ].filter((p): p is string => typeof p === 'string');
  if (parts.length === 0) return null;
  const last = parts.pop()!;
  return `Saving ${parts.length ? `${parts.join(', ')} and ${last}` : last}.`;
}
