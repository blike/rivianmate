import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { Dot } from '../../components/Dot';

/**
 * A titled card of setting rows, divided by hairlines. The title and its
 * note sit above the card, like a grouped list.
 */
export function SettingsGroup(props: {
  title?: string;
  note?: ReactNode;
  action?: ReactNode;
  ariaLabel?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={props.ariaLabel} className={`min-w-0 ${props.className ?? ''}`}>
      {(props.title || props.action) && (
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-1">
          {props.title && (
            <h3 className="text-xs font-medium uppercase tracking-wide text-(--text-muted)">
              {props.title}
            </h3>
          )}
          {props.action}
        </div>
      )}
      <div className="card divide-y divide-(--border)">{props.children}</div>
      {props.note && <p className="mt-2 px-1 text-xs text-(--text-muted)">{props.note}</p>}
    </section>
  );
}

/**
 * One setting: what it is on the left, its control on the right. Narrow
 * screens stack the control under the label.
 */
export function SettingRow(props: {
  label: ReactNode;
  description?: ReactNode;
  /** Id of the control, so the label names it. */
  htmlFor?: string;
  children?: ReactNode;
  /** Content under the row spanning the full width, e.g. an edit form. */
  below?: ReactNode;
}) {
  const label = props.htmlFor ? (
    <label htmlFor={props.htmlFor} className="text-sm font-medium">
      {props.label}
    </label>
  ) : (
    <div className="text-sm font-medium">{props.label}</div>
  );
  return (
    <div className="px-4 py-3.5">
      <div className="flex flex-col gap-x-6 gap-y-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          {label}
          {props.description && (
            <div className="mt-0.5 text-xs text-(--text-muted)">{props.description}</div>
          )}
        </div>
        {props.children != null && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
            {props.children}
          </div>
        )}
      </div>
      {props.below}
    </div>
  );
}

/** A big status line for the top of a section: eyebrow, headline, detail. */
export function SettingsHero(props: {
  eyebrow: ReactNode;
  tone?: 'good' | 'warning' | 'critical' | 'muted' | 'accent';
  pulse?: boolean;
  headline: ReactNode;
  detail?: ReactNode;
  children?: ReactNode;
}) {
  const color = {
    good: 'var(--status-good)',
    warning: 'var(--status-warning)',
    critical: 'var(--status-critical)',
    muted: 'var(--text-muted)',
    accent: 'var(--accent)',
  }[props.tone ?? 'muted'];
  return (
    <section className="card overflow-hidden">
      <div className="p-5">
        <div
          className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide"
          style={{ color }}
        >
          <Dot color={color} pulse={props.pulse} />
          {props.eyebrow}
        </div>
        <div className="mt-1.5 text-2xl font-semibold tracking-tight">{props.headline}</div>
        {props.detail && <div className="mt-1 text-sm text-(--text-secondary)">{props.detail}</div>}
      </div>
      {props.children}
    </section>
  );
}

export function SegmentedControl<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={props.label}
      className="flex rounded-lg bg-(--surface-2) p-0.5 text-sm"
    >
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === props.value}
          className={`rounded-md px-3 py-1 transition-colors ${
            o.value === props.value
              ? 'bg-(--accent) font-medium text-(--on-accent)'
              : 'text-(--text-secondary) hover:text-(--text-primary)'
          }`}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

type SelectOption<T extends string> = T | { value: T; label: string };

const optionOf = <T extends string>(o: SelectOption<T>) =>
  typeof o === 'string' ? { value: o, label: o } : o;

/** Options matching typed text, ignoring case and the underscores in names like Los_Angeles. */
export function matchOptions<T extends string>(
  options: readonly { value: T; label: string }[],
  query: string,
) {
  const plain = (text: string) => text.toLowerCase().replaceAll('_', ' ');
  const wanted = plain(query.trim());
  return wanted ? options.filter((o) => plain(o.label).includes(wanted)) : options;
}

/** Longer lists get a search box: nobody scrolls through every time zone. */
const SEARCH_FROM = 13;

/**
 * A dropdown sized and colored like SegmentedControl, drawn by the app like
 * VehicleMenu rather than by the browser. Arrows move through the list, Enter
 * picks, Escape or a click elsewhere closes it.
 */
export function Select<T extends string>(props: {
  id?: string;
  /** Names the list for screen readers. */
  label?: string;
  value: T;
  /** Each shown as its value, unless it has a label of its own. */
  options: readonly SelectOption<T>[];
  disabled?: boolean;
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
      if (e.key === 'Escape') e.stopPropagation();
      close(e.key === 'Escape');
      return;
    } else if (!searchable && e.key === 'Home') setActive(0);
    else if (!searchable && e.key === 'End') setActive(shown.length - 1);
    else return;
    e.preventDefault();
  };

  return (
    <div ref={rootRef} className="relative max-w-full">
      <button
        ref={triggerRef}
        id={props.id}
        type="button"
        disabled={props.disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? close() : show())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            show();
          }
        }}
        className="block max-w-full truncate rounded-lg bg-(--surface-2) py-1.5 pr-8 pl-3 text-left text-sm font-medium outline-none transition-colors hover:text-(--text-primary) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent) disabled:opacity-60"
      >
        {current?.label ?? props.value}
      </button>
      <svg
        viewBox="0 0 12 12"
        className="pointer-events-none absolute top-1/2 right-2.5 h-3 w-3 -translate-y-1/2 text-(--text-muted)"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden
      >
        <path d="M2.5 4.5 6 8l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>

      {open && (
        <div
          onKeyDown={onKey}
          className="card absolute top-full right-0 z-1100 mt-2 w-max max-w-[min(20rem,calc(100vw-2rem))] min-w-full overflow-hidden shadow-[0_12px_32px_rgba(0,0,0,0.45)]"
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
            className="max-h-[min(50vh,20rem)] overflow-auto py-1 outline-none"
          >
            {shown.length === 0 && (
              <div className="px-3 py-2 text-sm text-(--text-muted)">No matches</div>
            )}
            {shown.map((o, i) => {
              const selected = o.value === props.value;
              return (
                <div
                  key={o.value}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={selected}
                  onClick={() => choose(o.value)}
                  onPointerMove={() => setActive(i)}
                  className={`relative flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm ${
                    i === active ? 'bg-(--surface-2)' : ''
                  }`}
                >
                  {selected && (
                    <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-(--accent)" />
                  )}
                  <span className={`truncate ${selected ? 'font-medium' : ''}`}>{o.label}</span>
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
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function Switch(props: {
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      onClick={() => props.onChange(!props.checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent) ${
        props.checked ? 'bg-(--accent)' : 'bg-(--border)'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
          props.checked ? 'translate-x-4.5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

/** The quiet outlined button used for secondary actions in settings. */
export const secondaryButton =
  'rounded-md border border-[color-mix(in_srgb,var(--border)_60%,var(--text-muted))] bg-(--surface-2) px-3 py-1.5 text-sm font-medium text-(--text-primary) transition-colors hover:bg-[color-mix(in_srgb,var(--surface-2)_75%,var(--text-muted))] disabled:opacity-50 disabled:hover:bg-(--surface-2)';

export const dangerButton =
  'rounded-md border border-[color-mix(in_srgb,var(--status-critical)_55%,var(--border))] bg-[color-mix(in_srgb,var(--status-critical)_10%,var(--surface-1))] px-3 py-1.5 text-sm font-medium text-(--status-critical) transition-colors hover:bg-[color-mix(in_srgb,var(--status-critical)_20%,var(--surface-1))]';
