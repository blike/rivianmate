import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { TripActivityKind, TripSummaryDto } from '../api/client';
import { useSaveTrip, useTripAssignments, useTrips } from '../api/hooks';
import { dayLabel, tripDateLabel, widenedTo } from '../features/trips/trips';
import { browserTimeZone } from '../lib/format';
import { localKey } from '../lib/drives';
import { Dialog } from './Dialog';

/** Which trip a drive or charge is in, or a way to put it in one. */
export function AddToTrip(props: {
  vehicleId: string;
  kind: TripActivityKind;
  activityId: number;
  /** When it started (for a charge, when it charged): the day it's on. */
  startedAt: string;
}) {
  const { data: assignments } = useTripAssignments(props.vehicleId);
  const [open, setOpen] = useState(false);
  const assigned = assignments?.find(
    (a) => a.kind === props.kind && a.activityId === props.activityId,
  );
  if (!assignments) return null;
  if (assigned) {
    return (
      <Link to={`/trips/${assigned.tripId}`} className="text-(--accent) hover:underline">
        In {assigned.tripName}
      </Link>
    );
  }
  return (
    <>
      <button
        type="button"
        className="text-(--text-secondary) underline-offset-2 hover:text-(--text-primary) hover:underline"
        onClick={() => setOpen(true)}
      >
        Add to trip
      </button>
      <Dialog open={open} title="Add to trip" onClose={() => setOpen(false)}>
        <TripChooser {...props} onDone={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

function TripChooser(props: {
  vehicleId: string;
  kind: TripActivityKind;
  activityId: number;
  startedAt: string;
  onDone: () => void;
}) {
  const { data: trips } = useTrips(props.vehicleId);
  const save = useSaveTrip(props.vehicleId);
  const [name, setName] = useState('');
  const day = localKey(props.startedAt);
  const item = { kind: props.kind, id: props.activityId };
  const busy = save.isPending;
  // Trips whose days already take it in first; the rest as listed, newest first.
  const covers = (t: TripSummaryDto) => t.startDate != null && widenedTo(t, day) == null;
  const ordered = trips && [...trips.filter(covers), ...trips.filter((t) => !covers(t))];

  const addTo = async (trip: TripSummaryDto) => {
    await save.mutateAsync({
      tripId: trip.id,
      fields: { name: trip.name, ...widenedTo(trip, day) },
      add: [item],
      move: false,
      exclude: [],
      remove: [],
    });
    props.onDone();
  };
  // A trip of the day it's on, which takes in that day's other drives and charges.
  const createAndAdd = async () => {
    await save.mutateAsync({
      tripId: null,
      fields: { name: name.trim(), startDate: day, endDate: day, timeZone: browserTimeZone() },
      add: [item],
      move: false,
      exclude: [],
      remove: [],
    });
    props.onDone();
  };

  return (
    <div className="space-y-4">
      {ordered && ordered.length > 0 && (
        <ul className="max-h-60 divide-y divide-(--border) overflow-auto rounded-md border border-(--border)">
          {ordered.map((t) => {
            const widened = widenedTo(t, day);
            return (
              <li key={t.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void addTo(t).catch(() => {})}
                  className="block w-full px-3 py-2 text-left hover:bg-(--surface-2) disabled:opacity-50"
                >
                  <span className="block truncate text-sm">{t.name}</span>
                  <span className="block truncate text-xs text-(--text-muted) tabular-nums">
                    {[tripDateLabel(t) ?? 'No dates', widened && `extends to ${dayLabel(day)}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void createAndAdd().catch(() => {});
        }}
      >
        <input
          aria-label="New trip name"
          value={name}
          maxLength={120}
          placeholder="New trip name"
          onChange={(e) => setName(e.target.value)}
          className="min-w-0 flex-1 field"
        />
        <button type="submit" className="btn-secondary" disabled={busy || !name.trim()}>
          Create
        </button>
      </form>
      {save.error && <p className="text-sm text-(--status-critical)">{save.error.message}</p>}
      <div className="flex justify-end">
        <button type="button" className="btn-secondary" onClick={props.onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}
