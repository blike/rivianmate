import { type ReactNode, type RefObject, useEffect, useRef } from 'react';
import type { ChargingSessionDto, DriveDto, TripDetailDto } from '../../api/client';
import { useUnits } from '../../api/hooks';
import { ChargingIcon } from '../../components/AppIcons';
import { Row } from '../../components/Panel';
import {
  chargerLabel,
  chargingSecondsNow,
  formatMoney,
  sessionCity,
  sessionCost,
} from '../../lib/charging';
import { clock } from '../../lib/format';
import { sessionEnergy } from '../../lib/sessionEnergy';
import { fmt, fmtDuration, fmtSeconds } from '../../lib/state';
import { localKey } from '../../lib/drives';
import { chargeEnd, chargeStart } from '../charging/sessions';
import { driveFacts, driveTitle } from '../drives/format';
import { type JourneyStop, journeyDays, journeyStops } from './journey';
import { type TimelineEntry, outsideDates, timelineDays, overnightLabel } from './trips';

export type Selection = { kind: 'drive' | 'charge' | 'stop'; id: number } | null;

/** Just taken out of the trip, and can still be put back. */
export type Removed =
  { kind: 'drive'; drive: DriveDto } | { kind: 'charge'; session: ChargingSessionDto };

/**
 * The journey in order, by day, with the stops between its drives. What was
 * just removed keeps its place for a moment, as a line to undo it.
 */
export function TripTimeline(props: {
  trip: TripDetailDto;
  selected: Selection;
  onSelect: (selection: Selection) => void;
  onRemove: (kind: 'drive' | 'charge', id: number) => void;
  removed: Removed | null;
  /** Unset while the removal is still being saved. */
  onUndo: (() => void) | null;
  /** Looks for driving that isn't in the trip, from the day it went missing. */
  onFindMissing: (day: string) => void;
}) {
  const { trip, selected, onSelect, onRemove, removed } = props;
  // Held in place until the undo goes, even once the trip comes back without it.
  const drives =
    removed?.kind === 'drive' && !trip.drives.some((d) => d.id === removed.drive.id)
      ? [...trip.drives, removed.drive]
      : trip.drives;
  const sessions =
    removed?.kind === 'charge' && !trip.sessions.some((s) => s.id === removed.session.id)
      ? [...trip.sessions, removed.session]
      : trip.sessions;
  const isRemoved = (kind: 'drive' | 'charge', id: number) =>
    removed?.kind === kind &&
    (removed.kind === 'drive' ? removed.drive.id : removed.session.id) === id;
  const days = timelineDays(drives, sessions);
  const colors = new Map(journeyDays(drives, sessions).map((d) => [d.key, d.color]));
  const stopAt = new Map(
    journeyStops(drives, sessions)
      .filter((s) => s.kind === 'stop')
      .map((s) => [s.startedAt, s]),
  );
  const stopRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (selected?.kind === 'stop') stopRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);
  if (days.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-(--text-muted)">
        {trip.startDate != null
          ? 'Nothing in this trip yet. Drives and charges show up here as they finish.'
          : 'Nothing in this trip yet. Add drives and charges to build its timeline.'}
      </p>
    );
  }
  const charge = (session: ChargingSessionDto) =>
    isRemoved('charge', session.id) ? (
      <RemovedRow
        key={`charge-${session.id}`}
        title={`Charge at ${chargerLabel(session)}`}
        onUndo={props.onUndo}
      />
    ) : (
      <ChargeRow
        key={`charge-${session.id}`}
        session={session}
        outside={outsideDates(chargeStart(session), trip)}
        selected={selected?.kind === 'charge' && selected.id === session.id}
        onSelect={onSelect}
        onRemove={onRemove}
      />
    );
  return (
    <div>
      {days.map((day) => (
        <section key={day.key}>
          <h4 className="sticky top-0 z-10 flex items-center gap-2 border-b border-(--border) bg-(--surface-1) px-4 py-2 text-xs font-medium uppercase tracking-wide text-(--text-muted)">
            <span
              aria-hidden
              className="size-2 rounded-full"
              style={{ background: colors.get(localKey(day.items[0]!.startedAt)) }}
            />
            {day.label}
          </h4>
          <ul>
            {day.items.map((entry) =>
              entry.kind === 'drive' && isRemoved('drive', entry.drive.id) ? (
                <RemovedRow
                  key={`drive-${entry.drive.id}`}
                  title={driveTitle(entry.drive)}
                  onUndo={props.onUndo}
                />
              ) : entry.kind === 'drive' ? (
                <DriveRow
                  key={`drive-${entry.drive.id}`}
                  drive={entry.drive}
                  outside={outsideDates(entry.drive.startedAt, trip)}
                  selected={selected?.kind === 'drive' && selected.id === entry.drive.id}
                  onSelect={onSelect}
                  onRemove={onRemove}
                />
              ) : entry.kind === 'charge' ? (
                charge(entry.session)
              ) : entry.kind === 'missing' ? (
                <MissingRow
                  key={`missing-${entry.startedAt}`}
                  entry={entry}
                  onFind={() => props.onFindMissing(localKey(entry.startedAt))}
                />
              ) : (
                <StopRow
                  key={`stop-${entry.startedAt}`}
                  entry={entry}
                  stop={stopAt.get(entry.startedAt)}
                  selected={
                    selected?.kind === 'stop' && selected.id === stopAt.get(entry.startedAt)?.id
                  }
                  rowRef={stopRef}
                  onSelect={onSelect}
                >
                  {entry.charges.map(charge)}
                </StopRow>
              ),
            )}
          </ul>
        </section>
      ))}
    </div>
  );
}

function StopRow(props: {
  entry: Extract<TimelineEntry, { kind: 'stop' }>;
  stop: JourneyStop | undefined;
  selected: boolean;
  rowRef: RefObject<HTMLLIElement | null>;
  onSelect: (selection: Selection) => void;
  children: ReactNode;
}) {
  const { entry, stop } = props;
  const number = stop?.number ?? null;
  return (
    <li
      ref={props.selected ? props.rowRef : undefined}
      className={props.selected ? 'bg-(--surface-3)' : 'bg-(--surface-2)/40'}
    >
      <button
        type="button"
        aria-pressed={props.selected}
        onClick={() =>
          stop && props.onSelect(props.selected ? null : { kind: 'stop', id: stop.id })
        }
        className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-xs text-(--text-muted) hover:text-(--text-secondary)"
      >
        {number != null && <span className="rm-stop-number">{number}</span>}
        <span className="min-w-0 flex-1 truncate">
          {entry.nights > 0 && (
            <span className="mr-1.5 font-medium text-(--text-secondary)">
              {overnightLabel(entry.nights)}
            </span>
          )}
          {entry.place ? `Stopped at ${entry.place}` : 'Stopped'}
        </span>
        <span className="shrink-0 tabular-nums">{fmtDuration(entry.startedAt, entry.endedAt)}</span>
      </button>
      {entry.charges.length > 0 && <ul>{props.children}</ul>}
    </li>
  );
}

/**
 * Where one drive doesn't meet the next: driving the trip has no record of,
 * so it says so rather than calling the time parked, and offers to find it.
 */
function MissingRow(props: {
  entry: Extract<TimelineEntry, { kind: 'missing' }>;
  onFind: () => void;
}) {
  const { entry } = props;
  const between = [entry.from, entry.to].filter(Boolean).join(' → ');
  return (
    <li className="border-y border-dashed border-(--border)">
      <button
        type="button"
        title="Find the drive in Edit trip"
        onClick={props.onFind}
        className="group flex w-full items-center gap-2.5 px-4 py-2 text-left text-xs text-(--text-muted) hover:bg-(--surface-2)"
      >
        <span className="min-w-0 flex-1 truncate">
          <span className="mr-1.5 font-medium text-(--text-secondary)">Not in this trip</span>
          {between}
        </span>
        <span className="shrink-0 tabular-nums">{fmtDuration(entry.startedAt, entry.endedAt)}</span>
        <span className="shrink-0 text-(--accent) group-hover:underline">Find</span>
      </button>
    </li>
  );
}

/** Where a drive or charge was, just removed: a moment to put it back. */
function RemovedRow(props: { title: string; onUndo: (() => void) | null }) {
  return (
    <li className="flex items-center gap-2.5 px-4 py-2.5 text-xs text-(--text-muted)">
      <span role="status" className="min-w-0 flex-1 truncate">
        <span className="text-(--text-secondary)">{props.title}</span> removed
      </span>
      <button
        type="button"
        disabled={!props.onUndo}
        onClick={() => props.onUndo?.()}
        className="shrink-0 font-medium text-(--accent) hover:underline disabled:opacity-50"
      >
        Undo
      </button>
    </li>
  );
}

function ActivityRow(props: {
  icon?: ReactNode;
  time: string;
  title: ReactNode;
  detail: ReactNode;
  outside: boolean;
  selected: boolean;
  onToggle: () => void;
  onRemove: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLLIElement>(null);
  // Picked on the map, it may be scrolled out of sight.
  useEffect(() => {
    if (props.selected) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [props.selected]);
  return (
    <li ref={ref} className={props.selected ? 'bg-(--surface-2)' : ''}>
      <button
        type="button"
        aria-expanded={props.selected}
        onClick={props.onToggle}
        className="block w-full px-4 py-2.5 text-left hover:bg-(--surface-2)"
      >
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="min-w-0 truncate font-medium">
            {props.icon && (
              <span aria-hidden className="mr-1.5 text-(--accent)">
                {props.icon}
              </span>
            )}
            {props.title}
          </span>
          <span className="shrink-0 text-xs text-(--text-muted) tabular-nums">{props.time}</span>
        </div>
        <div className="mt-0.5 truncate text-xs text-(--text-secondary) tabular-nums">
          {props.detail}
        </div>
        {props.outside && (
          <div className="mt-0.5 text-xs text-(--status-warning)">Outside the trip’s dates</div>
        )}
      </button>
      {props.selected && (
        <div className="px-4 pb-3">
          <dl className="space-y-1 text-sm">{props.children}</dl>
          <button
            type="button"
            onClick={props.onRemove}
            className="mt-2 text-xs text-(--text-muted) underline-offset-2 hover:text-(--text-primary) hover:underline"
          >
            Remove from trip
          </button>
        </div>
      )}
    </li>
  );
}

function DriveRow(props: {
  drive: DriveDto;
  outside: boolean;
  selected: boolean;
  onSelect: (selection: Selection) => void;
  onRemove: (kind: 'drive' | 'charge', id: number) => void;
}) {
  const u = useUnits();
  const d = props.drive;
  return (
    <ActivityRow
      time={clock(d.startedAt)}
      title={driveTitle(d)}
      detail={[u.formatDistance(d.distanceKm), driveFacts(d, u)].join(' · ')}
      outside={props.outside}
      selected={props.selected}
      onToggle={() => props.onSelect(props.selected ? null : { kind: 'drive', id: d.id })}
      onRemove={() => props.onRemove('drive', d.id)}
    >
      <Row label="Distance" value={u.formatDistance(d.distanceKm, 1)} />
      <Row label="Duration" value={fmtDuration(d.startedAt, d.endedAt)} />
      <Row label="Efficiency" value={u.formatEfficiency(d.distanceKm, d.energyKwh)} />
      <Row label="Energy used" value={d.energyKwh != null ? `≈ ${fmt(d.energyKwh, 1)} kWh` : '—'} />
      {d.driver && <Row label="Driver" value={d.driver.name} />}
    </ActivityRow>
  );
}

function ChargeRow(props: {
  session: ChargingSessionDto;
  outside: boolean;
  selected: boolean;
  onSelect: (selection: Selection) => void;
  onRemove: (kind: 'drive' | 'charge', id: number) => void;
}) {
  const s = props.session;
  const energy = sessionEnergy(s, null);
  const energyLabel = energy ? `${energy.estimated ? '≈ ' : ''}${fmt(energy.kwh, 1)} kWh` : '—';
  const cost = sessionCost(s);
  const seconds = chargingSecondsNow(s);
  const city = sessionCity(s);
  return (
    <ActivityRow
      icon={<ChargingIcon className="inline-block size-3.5 align-[-2px]" />}
      time={`${clock(chargeStart(s))}${chargeEnd(s) ? ` – ${clock(chargeEnd(s)!)}` : ''}`}
      title={chargerLabel(s)}
      detail={[city, energyLabel, seconds != null && fmtSeconds(seconds)]
        .filter(Boolean)
        .join(' · ')}
      outside={props.outside}
      selected={props.selected}
      onToggle={() => props.onSelect(props.selected ? null : { kind: 'charge', id: s.id })}
      onRemove={() => props.onRemove('charge', s.id)}
    >
      <Row label="Location" value={city ?? chargerLabel(s)} />
      <Row label="Energy added" value={energyLabel} />
      <Row label="Time charging" value={seconds != null ? fmtSeconds(seconds) : '—'} />
      <Row label="Plugged in" value={fmtDuration(s.startedAt, s.endedAt)} />
      <Row
        label="Cost"
        value={
          cost
            ? `${cost.estimated ? '≈ ' : ''}${formatMoney(String(cost.amount), s.currency)}`
            : '—'
        }
      />
    </ActivityRow>
  );
}
