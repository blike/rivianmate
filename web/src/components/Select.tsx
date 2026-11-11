import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';

interface Option<T extends string> {
  value: T;
  label: string;
  /** Shown smaller beside the label, e.g. a vehicle's model. */
  detail?: string;
  /** Options with the same group sit together under its name, when there's more than one. */
  group?: string;
}

export type SelectOption<T extends string> = T | Option<T>;

const optionOf = <T extends string>(o: SelectOption<T>): Option<T> =>
  typeof o === 'string' ? { value: o, label: o } : o;

/** Options matching typed text, ignoring case and the underscores in names like Los_Angeles. */
export function matchOptions<O extends { label: string }>(options: readonly O[], query: string) {
  const plain = (text: string) => text.toLowerCase().replaceAll('_', ' ');
  const wanted = plain(query.trim());
  return wanted ? options.filter((o) => plain(o.label).includes(wanted)) : options;
}

/** Longer lists get a search box: nobody scrolls through every time zone. */
const SEARCH_FROM = 13;

/**
 * The app's dropdown, drawn by the app rather than the browser so it matches
 * the rest of the UI. Arrows move through the list, Enter picks, Escape or a
 * click elsewhere closes it. Its trigger is a small chip, unless `trigger`
 * draws one of its own.
 */
export function Select<T extends string>(props: {
  id?: string;
  /** Names the list for screen readers. */
  label?: string;
  value: T;
  /** Each shown as its value, unless it has a label of its own. */
  options: readonly SelectOption<T>[];
  disabled?: boolean;
  /** Small enough to sit in a line of text, its list opening under its left edge. */
  compact?: boolean;
  /** Which edge the list lines up with: the right, unless compact. */
  align?: 'left' | 'right';
  /** The trigger's content in place of the chip, given whether the list is open. */
  trigger?: (open: boolean) => ReactNode;
  /** Classes for a custom trigger; its list is as wide as it, unless `fitList`. */
  triggerClassName?: string;
  /** A custom trigger's list sized to its options, for a trigger narrower than them. */
  fitList?: boolean;
  /** Labels the chip is kept as wide as the widest of, so it holds its width whatever is chosen. */
  widthOf?: readonly string[];
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const options = props.options.map(optionOf);
  const searchable = options.length >= SEARCH_FROM;
  const shown = matchOptions(options, query);
  const current = options.find((o) => o.value === props.value);
  const grouped = new Set(options.map((o) => o.group)).size > 1;
  const custom = props.trigger != null;

  const show = () => {
    setQuery('');
    setActive(
      Math.max(
        options.findIndex((o) => o.value === props.value),
        0,
      ),
    );
    setOpen(true);
  };
  const close = (refocus = false) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };
  const choose = (value: T) => {
    close(true);
    if (value !== props.value) props.onChange(value);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  useEffect(() => {
    if (open) (searchRef.current ?? listRef.current)?.focus({ preventScroll: true });
  }, [open]);

  // Keeps the chosen or highlighted option in view in a long list.
  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active, listId]);

  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown') setActive((i) => Math.min(i + 1, shown.length - 1));
    else if (e.key === 'ArrowUp') setActive((i) => Math.max(i - 1, 0));
    else if (e.key === 'Enter' || (e.key === ' ' && !searchable)) {
      if (shown[active]) choose(shown[active].value);
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      // Escape stays inside (an open mobile menu closes on it too).
      if (e.key === 'Escape') e.stopPropagation();
      close(e.key === 'Escape');
      return;
    } else if (!searchable && e.key === 'Home') setActive(0);
    else if (!searchable && e.key === 'End') setActive(shown.length - 1);
    else return;
    e.preventDefault();
  };

  const left = (props.align ?? (props.compact ? 'left' : 'right')) === 'left';
  return (
    <div ref={rootRef} className={custom ? 'relative' : 'relative max-w-full'}>
      <button
        ref={triggerRef}
        id={props.id}
        type="button"
        disabled={props.disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={custom ? `${props.label}: ${current?.label ?? 'none'}` : undefined}
        onClick={() => (open ? close() : show())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            show();
          }
        }}
        className={
          custom
            ? `w-full text-left transition-colors hover:bg-(--surface-2) aria-expanded:bg-(--surface-2) ${props.triggerClassName ?? ''}`
            : `block max-w-full truncate bg-(--surface-2) text-left font-medium text-(--text-primary) outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent) disabled:opacity-60 ${
                props.compact
                  ? 'rounded-md py-0.5 pr-6 pl-2 text-xs'
                  : 'rounded-lg py-1.5 pr-8 pl-3 text-sm'
              }`
        }
      >
        {custom ? (
          props.trigger!(open)
        ) : props.widthOf ? (
          // Every label in one cell, only the chosen one seen: as wide as the widest.
          <span className="grid">
            {[...new Set([current?.label ?? props.value, ...props.widthOf])].map((label, i) => (
              <span key={label} className={`[grid-area:1/1] ${i === 0 ? '' : 'invisible'}`}>
                {label}
              </span>
            ))}
          </span>
        ) : (
          (current?.label ?? props.value)
        )}
      </button>
      {!custom && (
        <svg
          viewBox="0 0 12 12"
          className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-(--text-muted) ${
            props.compact ? 'right-1.5 h-2.5 w-2.5' : 'right-2.5 h-3 w-3'
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden
        >
          <path d="M2.5 4.5 6 8l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}

      {open && (
        <div
          onKeyDown={onKey}
          className={`card absolute top-full z-1100 mt-2 overflow-hidden text-(--text-primary) shadow-[0_12px_32px_rgba(0,0,0,0.45)] ${
            custom && !props.fitList
              ? 'inset-x-0'
              : `w-max max-w-[min(20rem,calc(100vw-2rem))] min-w-full ${left ? 'left-0' : 'right-0'}`
          }`}
        >
          {searchable && (
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder="Search"
              aria-label={`Search ${props.label ?? 'options'}`}
              aria-controls={listId}
              aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              className="w-full border-b border-(--hairline) bg-transparent px-3 py-2 text-sm outline-none"
            />
          )}
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-label={props.label}
            aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
            // Rows inset with rounded highlights, so none meets the card's edge.
            className="max-h-[min(50vh,20rem)] overflow-auto p-1 outline-none"
          >
            {shown.length === 0 && (
              <div className="px-3 py-2 text-sm text-(--text-muted)">No matches</div>
            )}
            {shown.map((o, i) => {
              const selected = o.value === props.value;
              const group = o.group;
              const prev = shown[i - 1];
              const startsGroup = grouped && group != null && prev?.group !== group;
              return (
                <div key={o.value}>
                  {startsGroup && (
                    <div
                      className={`eyebrow px-2.5 pt-2 pb-1 ${i > 0 ? 'mt-1 border-t border-(--hairline)' : ''}`}
                    >
                      {group}
                    </div>
                  )}
                  <div
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={selected}
                    onClick={() => choose(o.value)}
                    onPointerMove={() => setActive(i)}
                    className={`relative flex cursor-pointer items-center justify-between gap-3 rounded-md px-2.5 py-2 text-sm ${
                      i === active ? 'bg-(--surface-2)' : ''
                    }`}
                  >
                    {selected && (
                      <span
                        aria-hidden
                        className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-(--accent)"
                      />
                    )}
                    <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                      <span className={`truncate ${selected ? 'font-medium' : ''}`}>{o.label}</span>
                      {o.detail && (
                        <span className="shrink-0 text-xs text-(--text-muted)">{o.detail}</span>
                      )}
                    </span>
                    {selected && (
                      <svg
                        viewBox="0 0 16 16"
                        className="h-3.5 w-3.5 shrink-0 text-(--accent)"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <path d="m3.5 8.5 3 3 6-7" />
                      </svg>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
