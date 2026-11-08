import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Select } from './Select';
import { localKey } from '../lib/drives';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** The first of the month `d` falls in, at local midnight. */
export const monthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);

const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);

/** Accent strength (%) behind a day by how busy it was against the month's busiest. */
const TINTS = [14, 24, 36, 50];
const tintOf = (count: number, max: number) =>
  TINTS[Math.min(TINTS.length - 1, Math.ceil((count / max) * TINTS.length) - 1)]!;
const tint = (pct: number) => `color-mix(in srgb, var(--accent) ${pct}%, transparent)`;

export const CalendarIcon = (props: { className: string }) => (
  <svg
    viewBox="0 0 16 16"
    className={props.className}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <rect x="2.5" y="3.5" width="11" height="10" rx="2" />
    <path d="M2.5 6.75h11M5.5 2v3M10.5 2v3" />
  </svg>
);

/** Every month's name, so the month dropdown is as wide as the longest whichever is chosen. */
const MONTH_NAMES = Array.from({ length: 12 }, (_, i) =>
  new Date(2000, i, 1).toLocaleDateString([], { month: 'long' }),
);

/** Months before this many years back aren't offered when the first record isn't known. */
const YEARS_BACK = 10;

/** The month's days, padded with blanks to start on a Sunday. */
function monthCells(month: Date): (Date | null)[] {
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  return [
    ...Array.from({ length: month.getDay() }, () => null),
    ...Array.from(
      { length: days },
      (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1),
    ),
  ];
}

/**
 * A button that opens a month calendar showing how many records (drives,
 * sessions) started each day; picking a day with any hands back its key
 * (YYYY-MM-DD). The month shown is the caller's, so it can load that
 * month's counts; months before `earliest` or after this one can't be
 * reached. Escape or a click elsewhere closes it.
 */
export function DayCalendar(props: {
  /** What's counted, singular, e.g. "drive". */
  noun: string;
  month: Date;
  onMonthChange: (month: Date) => void;
  /** Records per day key; undefined while loading. */
  counts: ReadonlyMap<string, number> | undefined;
  selectedKey: string | null;
  onPick: (key: string) => void;
  /** The first month with records, if known. */
  earliest?: Date | null;
  /** Called as it opens, to start loading. */
  onOpen?: () => void;
  className?: string;
}) {
  return (
    <CalendarPopover
      label="Go to a date"
      className={`relative ${props.className ?? ''}`}
      panelClassName="right-0 w-[20rem] max-w-[calc(100vw-2rem)]"
      onOpen={props.onOpen}
      trigger={(t) => (
        <button
          {...t}
          type="button"
          aria-label={`Pick a day to show ${props.noun}s from`}
          title="Go to a date"
          className={`grid h-8 w-8 place-items-center rounded-full border border-(--hairline) transition-colors hover:bg-(--surface-2) hover:text-(--text-primary) ${
            t['aria-expanded']
              ? 'bg-(--surface-2) text-(--text-primary)'
              : 'text-(--text-secondary)'
          }`}
        >
          <CalendarIcon className="h-5 w-5" />
        </button>
      )}
    >
      {(close) => (
        <CalendarMonth
          {...props}
          onPick={(key) => {
            props.onPick(key);
            close(true);
          }}
        />
      )}
    </CalendarPopover>
  );
}

/**
 * A calendar opened from a trigger, below it: Escape or a click elsewhere
 * closes it. The trigger gets what it needs spread onto its button. Unless
 * `className` positions the root, the panel lines up with the nearest
 * positioned ancestor, so a narrow field's calendar can use a wider row.
 */
export function CalendarPopover(props: {
  /** Names the opened calendar. */
  label: string;
  trigger: (t: {
    id: string;
    onClick: () => void;
    disabled?: boolean;
    'aria-haspopup': 'dialog';
    'aria-expanded': boolean;
  }) => ReactNode;
  /** Its edge and width, e.g. "right-0 w-[20rem]". */
  panelClassName: string;
  /** Called as it opens, to start loading. */
  onOpen?: () => void;
  disabled?: boolean;
  className?: string;
  children: (close: (refocus?: boolean) => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // Found by id, not a ref, so what's inside can be handed `close`.
  const triggerId = useId();

  const close = (refocus = false) => {
    setOpen(false);
    if (refocus) document.getElementById(triggerId)?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={props.className ?? 'relative'}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          close(true);
        }
      }}
    >
      {props.trigger({
        id: triggerId,
        disabled: props.disabled,
        'aria-haspopup': 'dialog',
        'aria-expanded': open,
        onClick: () => {
          if (!open) props.onOpen?.();
          setOpen(!open);
        },
      })}

      {open && !props.disabled && (
        <div
          role="dialog"
          aria-label={props.label}
          className={`card absolute top-full z-1100 mt-2 p-4 shadow-[0_16px_40px_rgba(0,0,0,0.5)] ${props.panelClassName}`}
        >
          {props.children(close)}
        </div>
      )}
    </div>
  );
}

/**
 * One month of the calendar: steps to the months either side, and each
 * day with how many records started on it. Days without any can't be
 * picked, unless `pickAny`: then it's picking a date, the counts a guide.
 */
export function CalendarMonth(props: {
  noun: string;
  /** The noun for more than one, when adding "s" won't do. */
  nouns?: string;
  month: Date;
  onMonthChange: (month: Date) => void;
  counts: ReadonlyMap<string, number> | undefined;
  selectedKey: string | null;
  onPick: (key: string) => void;
  earliest?: Date | null;
  /** The last month that can be reached; this one, unless given. */
  latest?: Date;
  pickAny?: boolean;
  /** Days before this key can't be picked. */
  minKey?: string;
  /** Days outlined as a span, both ends included. */
  range?: { from: string; to: string } | null;
  /** Today, for tests. */
  now?: Date;
}) {
  const now = props.now ?? new Date();
  const today = localKey(now);
  const month = monthStart(props.month);
  const last = monthStart(props.latest ?? now);
  const atLatest = month.getTime() >= last.getTime();
  const atEarliest =
    props.earliest != null && month.getTime() <= monthStart(props.earliest).getTime();
  const max = props.counts ? Math.max(0, ...props.counts.values()) : 0;

  // Months that can be reached: from the first with records (or some years
  // back) to the latest. A month or year picked past either end stops there.
  const first = monthStart(props.earliest ?? new Date(now.getFullYear() - YEARS_BACK, 0, 1));
  const go = (year: number, monthIndex: number) => {
    const t = new Date(year, monthIndex, 1).getTime();
    props.onMonthChange(new Date(Math.min(Math.max(t, first.getTime()), last.getTime())));
  };
  const year = month.getFullYear();
  const years = Array.from({ length: last.getFullYear() - first.getFullYear() + 1 }, (_, i) =>
    String(last.getFullYear() - i),
  );
  const months = Array.from({ length: 12 }, (_, i) => new Date(year, i, 1))
    .filter((m) => m >= first && m <= last)
    .map((m) => ({
      value: String(m.getMonth()),
      label: m.toLocaleDateString([], { month: 'long' }),
    }));
  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Select
            label="Month"
            align="left"
            value={String(month.getMonth())}
            options={months}
            widthOf={MONTH_NAMES}
            onChange={(m) => go(year, Number(m))}
          />
          <Select
            label="Year"
            align="left"
            value={String(year)}
            options={years}
            widthOf={years}
            onChange={(y) => go(Number(y), month.getMonth())}
          />
        </div>
        <div className="flex gap-1">
          <MonthStep
            label="Previous month"
            disabled={atEarliest}
            onClick={() => props.onMonthChange(addMonths(month, -1))}
          >
            <path d="M10 3.5 5.5 8l4.5 4.5" />
          </MonthStep>
          <MonthStep
            label="Next month"
            disabled={atLatest}
            onClick={() => props.onMonthChange(addMonths(month, 1))}
          >
            <path d="M6 3.5 10.5 8 6 12.5" />
          </MonthStep>
        </div>
      </div>

      <div
        className={`grid grid-cols-7 gap-1 text-center transition-opacity ${
          props.counts ? '' : 'opacity-50'
        }`}
      >
        {WEEKDAYS.map((d, i) => (
          <div key={i} aria-hidden className="eyebrow pb-1">
            {d}
          </div>
        ))}
        {monthCells(month).map((day, i) => {
          if (!day) return <div key={`blank-${i}`} />;
          const key = localKey(day);
          const count = props.counts?.get(key) ?? 0;
          const selected = key === props.selectedKey;
          const isToday = key === today;
          const pickable =
            (props.pickAny || count > 0) && (props.minKey == null || key >= props.minKey);
          const inRange = props.range != null && key >= props.range.from && key <= props.range.to;
          const label = day.toLocaleDateString([], {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          });
          return (
            <button
              key={key}
              type="button"
              disabled={!pickable}
              aria-pressed={selected}
              aria-label={`${label}: ${count} ${count === 1 ? props.noun : (props.nouns ?? `${props.noun}s`)}`}
              onClick={() => props.onPick(key)}
              style={!selected && count > 0 ? { background: tint(tintOf(count, max)) } : undefined}
              className={`relative flex h-11 flex-col items-center justify-center gap-1 rounded-xl text-sm tabular-nums transition-shadow disabled:cursor-default ${
                selected
                  ? 'bg-(--accent) font-semibold text-(--on-accent)'
                  : !pickable
                    ? 'text-(--text-muted) opacity-40'
                    : `hover:ring-1 hover:ring-(--accent) hover:ring-inset ${
                        count > 0 ? 'font-medium' : 'text-(--text-secondary)'
                      }`
              } ${
                selected
                  ? ''
                  : inRange
                    ? 'ring-1 ring-[color-mix(in_srgb,var(--accent)_55%,transparent)] ring-inset'
                    : isToday
                      ? 'ring-1 ring-(--text-muted) ring-inset'
                      : ''
              }`}
            >
              <span className="leading-none">{day.getDate()}</span>
              {/* Held even on days without any, so every date sits at the same height. */}
              <span
                aria-hidden
                className={`text-[10px] leading-none ${
                  count === 0 ? 'invisible' : selected ? 'opacity-70' : 'text-(--text-secondary)'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div
        aria-hidden
        className="mt-3 flex items-center justify-end gap-1.5 border-t border-(--hairline) pt-3 text-[11px] text-(--text-muted)"
      >
        Fewer
        {TINTS.map((pct) => (
          <span key={pct} className="h-2.5 w-2.5 rounded-[3px]" style={{ background: tint(pct) }} />
        ))}
        More
      </div>
    </>
  );
}

function MonthStep(props: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
      className="grid h-8 w-8 place-items-center rounded-lg text-(--text-secondary) transition-colors hover:bg-(--surface-2) hover:text-(--text-primary) disabled:opacity-30 disabled:hover:bg-transparent"
    >
      <svg
        viewBox="0 0 16 16"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {props.children}
      </svg>
    </button>
  );
}
