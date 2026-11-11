/** One size for every calendar page, whatever the dates, so cards line up. */
export const CALENDAR_PAGE = 'h-[4.5rem] w-20 shrink-0 rounded-lg';

export interface CalendarDates {
  /** "Jun", or "Jun – Jul" across months. */
  month: string;
  /** "20", or "18–22" for a range. */
  days: string;
  /** "2026", or "2026–27" across years. */
  year: string;
}

/** A date or a range of dates as a tear-off calendar page; a blank page without one. */
export function CalendarPage(props: { calendar: CalendarDates | null }) {
  const c = props.calendar;
  return (
    <div
      aria-label={c ? undefined : 'No dates yet'}
      className={`${CALENDAR_PAGE} flex flex-col overflow-hidden border border-(--border) bg-(--surface-2) text-center`}
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
