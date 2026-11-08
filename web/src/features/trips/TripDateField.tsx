import { useMemo, useState } from 'react';
import { useTripCandidates } from '../../api/hooks';
import {
  CalendarIcon,
  CalendarMonth,
  CalendarPopover,
  monthStart,
} from '../../components/DayCalendar';
import { localKey } from '../../lib/drives';
import { chargeStart } from '../charging/sessions';
import { dayStart } from './trips';

/** How far ahead a trip still to come can be set. */
const YEARS_AHEAD = 1;

/**
 * A trip's start or end: a field that opens the calendar Drives and Charging
 * go to a date with, each day tinted by what was driven or charged on it, so
 * the trip's days are easy to find. Any day can be picked, past or to come;
 * `minKey` keeps an end from coming before the start, and `range` outlines
 * the trip's days so far.
 */
export function TripDateField(props: {
  vehicleId: string;
  /** The trip being edited, so its own activities count. */
  tripId?: number;
  label: string;
  /** YYYY-MM-DD, or '' with none. */
  value: string;
  /** Shown with no date. */
  placeholder: string;
  onPick: (key: string) => void;
  /** The month it opens on with no date. */
  near?: string;
  minKey?: string;
  range?: { from: string; to: string } | null;
  disabled?: boolean;
  /** Which edge of the row its calendar lines up with. */
  align: 'left' | 'right';
}) {
  const now = new Date();
  const [month, setMonth] = useState(() => monthStart(now));
  const [opened, setOpened] = useState(false);
  const to = new Date(month.getFullYear(), month.getMonth() + 1, 1, 0, 0, 0, -1);
  // A month still to come has nothing in it to read.
  const ahead = month > now;
  const { data, isPlaceholderData } = useTripCandidates(
    props.vehicleId,
    month,
    to,
    opened && !ahead,
    props.tripId,
  );
  const counts = useMemo(() => {
    if (ahead) return new Map<string, number>();
    // Another month's, kept while this one loads, would tint nothing here.
    if (!data || isPlaceholderData) return undefined;
    const days = new Map<string, number>();
    const count = (at: string) => {
      const key = localKey(at);
      days.set(key, (days.get(key) ?? 0) + 1);
    };
    for (const d of data.drives) count(d.startedAt);
    // On the day it charged, as the builder's list has it.
    for (const s of data.sessions) count(chargeStart(s));
    return days;
  }, [ahead, data, isPlaceholderData]);

  const shown = props.value
    ? dayStart(props.value).toLocaleDateString([], {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : props.placeholder;

  return (
    <CalendarPopover
      label={`Pick the trip’s ${props.label.toLowerCase()}`}
      // Unpositioned: the calendar lines up with the row, wider than the field.
      className="block"
      panelClassName={`${props.align === 'left' ? 'left-0' : 'right-0'} w-[min(20rem,100%)]`}
      disabled={props.disabled}
      onOpen={() => {
        const at = props.value || props.near;
        setMonth(monthStart(at ? dayStart(at) : now));
        setOpened(true);
      }}
      trigger={(t) => (
        <label className="block text-sm font-medium">
          {props.label}
          <button
            {...t}
            type="button"
            className={`mt-1 flex w-full items-center justify-between gap-2 rounded-md border bg-(--surface-2) px-2.5 py-1.5 text-left text-sm font-normal tabular-nums outline-none focus:border-(--text-muted) disabled:opacity-50 ${
              t['aria-expanded'] ? 'border-(--text-muted)' : 'border-(--border)'
            }`}
          >
            <span className={`truncate ${props.value ? '' : 'text-(--text-muted)'}`}>{shown}</span>
            <CalendarIcon className="h-4 w-4 shrink-0 text-(--text-muted)" />
          </button>
        </label>
      )}
    >
      {(close) => (
        <CalendarMonth
          noun="drive or charge"
          nouns="drives and charges"
          month={month}
          onMonthChange={setMonth}
          counts={counts}
          selectedKey={props.value || null}
          onPick={(key) => {
            props.onPick(key);
            close(true);
          }}
          latest={new Date(now.getFullYear() + YEARS_AHEAD, 11, 1)}
          pickAny
          minKey={props.minKey}
          range={props.range}
        />
      )}
    </CalendarPopover>
  );
}
