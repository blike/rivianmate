import { useQuery } from '@tanstack/react-query';
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { monthStart } from '../components/DayCalendar';
import { groupByDay, localKey } from './drives';

type Listed = { id: number; startedAt: string };

const byStart = (item: { startedAt: string }) => item.startedAt;

/**
 * Going to a date in a list read a page at a time (drives, sessions): a
 * month's records for the calendar, read once it's first opened, and
 * picking a day selects its latest record. One the list doesn't hold yet
 * opens the list there, rather than reading every page back to it (years
 * of them, for a long history). Spread `calendar` into a DayCalendar; hand
 * `revealId` and `clearReveal` to the list so it scrolls there once it has.
 */
export function useGoToDate<T extends Listed>(options: {
  /** The listing's query key; each month is read under it, so what refreshes the list refreshes these. */
  queryKey: readonly unknown[];
  /** Every record that started in [from, to]. */
  fetchWindow: (from: Date, to: Date) => Promise<T[]>;
  /** What the list has read so far, newest first. */
  listed: readonly T[] | undefined;
  /** Opens the list at the records that started before a time. */
  jumpTo: (before: Date) => void;
  selected: T | null | undefined;
  onSelect: (id: number) => void;
  /** When a record counts as on its day, as the list groups it; when it started, unless given. */
  dayOf?: (item: T) => string;
  /** The first month with records, if known. */
  earliest?: Date | null;
}) {
  const dayOf = options.dayOf ?? byStart;
  const [month, setMonth] = useState(() => monthStart(new Date()));
  const [used, setUsed] = useState(false);
  const from = month;
  const to = new Date(month.getFullYear(), month.getMonth() + 1, 1, 0, 0, 0, -1);
  const { data } = useQuery({
    queryKey: [...options.queryKey, 'month', from.toISOString()],
    queryFn: () => options.fetchWindow(from, to),
    enabled: used,
    staleTime: 60_000,
  });
  const days = useMemo(
    () => data && new Map(groupByDay(data, new Date(), dayOf).map((day) => [day.key, day.items])),
    [data, dayOf],
  );
  const counts = useMemo(
    () => days && new Map([...days].map(([key, items]) => [key, items.length])),
    [days],
  );

  // The picked record, until the list shows it and has scrolled there.
  const [revealId, setRevealId] = useState<number | null>(null);
  const clearReveal = useCallback(() => setRevealId(null), []);
  const { listed, jumpTo, onSelect, selected } = options;

  return {
    revealId,
    clearReveal,
    calendar: {
      month,
      onMonthChange: setMonth,
      counts,
      selectedKey: selected ? localKey(new Date(dayOf(selected))) : null,
      onPick: (key: string) => {
        const latest = days?.get(key)?.[0];
        if (!latest) return;
        onSelect(latest.id);
        setRevealId(latest.id);
        // Opened just above it, so it heads the list. Listed to the millisecond.
        if (!listed?.some((r) => r.id === latest.id)) {
          jumpTo(new Date(Date.parse(latest.startedAt) + 1));
        }
      },
      earliest: options.earliest,
      onOpen: () => {
        setUsed(true);
        setMonth(monthStart(selected ? new Date(dayOf(selected)) : new Date()));
      },
    },
  };
}

/**
 * For a list of records by day: scrolls `revealId`'s day to the top of the
 * list once it's listed (each record marked `data-record-id`, each day a
 * `section`), then calls `onRevealed`. Moves the list, not the page.
 */
export function useRevealed(
  revealId: number | null | undefined,
  onRevealed: (() => void) | undefined,
  /** Changes as more of the list is read. */
  listed: unknown,
) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (revealId == null) return;
    const item = rootRef.current?.querySelector(`[data-record-id="${revealId}"]`);
    if (!item) return;
    scrollToTop(item.closest('section') ?? item);
    onRevealed?.();
  }, [revealId, onRevealed, listed]);
  return rootRef;
}

/**
 * For a list of records (each marked `data-record-id`) that reads newer
 * ones in above what's shown: wraps that read so the record that headed
 * the list stays where it was once they arrive, rather than being pushed
 * a page down. `firstId` is the record heading the list.
 */
export function useHeldInPlace(
  rootRef: RefObject<HTMLElement | null>,
  firstId: number | undefined,
) {
  const held = useRef<{ el: Element; top: number } | null>(null);
  useLayoutEffect(() => {
    const h = held.current;
    if (!h) return;
    held.current = null;
    const box = h.el.isConnected ? scrollBox(h.el) : null;
    if (box) box.scrollTop += h.el.getBoundingClientRect().top - h.top;
  }, [firstId]);
  return useCallback(
    (load: () => void) => () => {
      const el = rootRef.current?.querySelector('[data-record-id]');
      if (el) held.current = { el, top: el.getBoundingClientRect().top };
      load();
    },
    [rootRef],
  );
}

/** The nearest box around `el` that scrolls. */
function scrollBox(el: Element): HTMLElement | null {
  let box = el.parentElement;
  while (box && !/auto|scroll/.test(getComputedStyle(box).overflowY)) box = box.parentElement;
  return box;
}

/** Scrolls the nearest scrolling box around `el` so `el` sits at its top, leaving the page be. */
function scrollToTop(el: Element) {
  const box = scrollBox(el);
  if (!box) return;
  box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top;
}
