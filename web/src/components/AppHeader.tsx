import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import type { VehicleDto } from '@server/api-types';

export const NAV = [
  { to: '/', label: 'Dashboard' },
  { to: '/history', label: 'History' },
  { to: '/drives', label: 'Drives' },
  { to: '/charging', label: 'Charging' },
  { to: '/health', label: 'Health' },
  { to: '/settings', label: 'Settings' },
];

/** Matches Tailwind's `md`, where the links and a vehicle picker fit across the header. */
const WIDE = '(min-width: 768px)';

/**
 * Brand, navigation and vehicle picker. From `md` up the sections are links
 * across the header. On phones a menu button opens a sheet that drops from
 * the top behind the brand and button, so the header itself never moves or
 * changes size. The sheet sits above map panes and controls (z-index ≤ 1000)
 * and belongs to the page it was opened on, so navigating closes it in the
 * same render as the new page.
 */
export function AppHeader(props: {
  vehicles: VehicleDto[] | undefined;
  vehicleId: string | undefined;
  onSelectVehicle: (id: string) => void;
}) {
  const { pathname } = useLocation();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const close = () => setOpenOn(null);
  const menuId = useId();
  const rowRef = useRef<HTMLDivElement>(null);
  // Where the sheet's links start: just under the header row.
  const [sheetTop, setSheetTop] = useState(0);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenOn(null);
    };
    // Widening past the breakpoint shows the inline links instead.
    const wide = window.matchMedia(WIDE);
    const onWide = () => wide.matches && setOpenOn(null);
    // The page behind stays put while the sheet is open.
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    wide.addEventListener('change', onWide);
    return () => {
      root.style.overflow = overflow;
      document.removeEventListener('keydown', onKey);
      wide.removeEventListener('change', onWide);
    };
  }, [open]);

  const multipleVehicles = props.vehicles != null && props.vehicles.length > 1;
  const rivian = props.vehicles?.filter((v) => v.source !== 'teslamate') ?? [];
  const tesla = props.vehicles?.filter((v) => v.source === 'teslamate') ?? [];
  // Grouped by where the data comes from, when there's more than one source.
  const vehicleGroups: VehicleGroup[] =
    rivian.length > 0 && tesla.length > 0
      ? [
          { label: 'Rivian', vehicles: rivian },
          { label: 'TeslaMate', vehicles: tesla },
        ]
      : [{ vehicles: props.vehicles ?? [] }];

  return (
    <header className="py-4">
      {/* One fixed height at every width; above the sheet while it's open. */}
      <div ref={rowRef} className={`flex h-8 items-center gap-4 ${open ? 'relative z-1100' : ''}`}>
        <h1 className="text-xl font-semibold leading-8 tracking-tight">
          Rivian<span className="text-(--accent)">Mate</span>
        </h1>

        <nav aria-label="Main" className="hidden h-8 gap-1 md:flex">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex h-8 items-center rounded-md px-3 text-sm ${
                  isActive
                    ? 'bg-(--surface-2) text-(--text-primary)'
                    : 'text-(--text-secondary) hover:text-(--text-primary)'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        {multipleVehicles && (
          <VehicleSelect
            className="ml-auto h-8 min-w-0 max-w-[45vw] text-sm md:max-w-none"
            groups={vehicleGroups}
            value={props.vehicleId}
            onChange={props.onSelectVehicle}
          />
        )}

        <button
          type="button"
          className={`-mr-1.5 grid h-8 w-8 shrink-0 ${multipleVehicles ? '-ml-1.5' : 'ml-auto'} place-items-center rounded-md text-(--text-primary) [-webkit-tap-highlight-color:transparent] md:hidden`}
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => {
            if (open) return close();
            setSheetTop(rowRef.current?.getBoundingClientRect().bottom ?? 0);
            setOpenOn(pathname);
          }}
        >
          <MenuIcon open={open} />
        </button>
      </div>

      {open && (
        <>
          <div
            aria-hidden
            className="rm-fade-in fixed inset-0 z-1090 bg-black/60 md:hidden"
            onClick={close}
          />
          <div
            id={menuId}
            className="rm-sheet-in fixed inset-x-0 top-0 z-1095 border-b border-(--border) bg-(--surface-0) shadow-[0_24px_48px_-24px_rgba(0,0,0,0.9)] md:hidden"
            style={{ paddingTop: sheetTop + 12 }}
          >
            <nav aria-label="Main" className="mx-auto max-w-6xl px-4 pb-2">
              <ul>
                {NAV.map((item, i) => (
                  <li
                    key={item.to}
                    className="rm-item-in"
                    style={{ animationDelay: `${40 + i * 25}ms` }}
                  >
                    <NavLink
                      to={item.to}
                      end={item.to === '/'}
                      // Other pages close the menu by navigating; this one has to.
                      onClick={() => item.to === pathname && close()}
                      className={({ isActive }) =>
                        `flex items-center justify-between ${i < NAV.length - 1 ? 'border-b border-(--border)' : ''} py-3.5 text-[1rem] font-semibold tracking-tight [-webkit-tap-highlight-color:transparent] active:opacity-60 ${
                          isActive ? 'text-(--accent)' : 'text-(--text-primary)'
                        }`
                      }
                    >
                      {item.label}
                      <svg
                        viewBox="0 0 16 16"
                        className="h-4 w-4 text-(--text-muted)"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <path d="M6 3.5 10.5 8 6 12.5" />
                      </svg>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </>
      )}
    </header>
  );
}

interface VehicleGroup {
  /** Shown above the group; left out when there's only one. */
  label?: string;
  vehicles: VehicleDto[];
}

const vehicleName = (v: VehicleDto) => v.name ?? v.model ?? v.vin;

/**
 * The vehicle dropdown, drawn by the app rather than the browser so it
 * matches the rest of the header. Arrows move through the list, Enter picks,
 * Escape or a click elsewhere closes it.
 */
function VehicleSelect(props: {
  className: string;
  groups: VehicleGroup[];
  value: string | undefined;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const flat = props.groups.flatMap((g) => g.vehicles);
  const index = flat.findIndex((v) => v.id === props.value);
  const current = flat[index];

  const show = () => {
    setActive(Math.max(index, 0));
    setOpen(true);
  };
  const close = (refocus = false) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };
  const choose = (id: string) => {
    close(true);
    if (id !== props.value) props.onChange(id);
  };

  // Close on a tap or click anywhere else.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  useEffect(() => {
    if (open) listRef.current?.focus({ preventScroll: true });
  }, [open]);

  const onListKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown') setActive((i) => Math.min(i + 1, flat.length - 1));
    else if (e.key === 'ArrowUp') setActive((i) => Math.max(i - 1, 0));
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(flat.length - 1);
    else if (e.key === 'Enter' || e.key === ' ') {
      if (flat[active]) choose(flat[active].id);
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      close(e.key === 'Escape');
      return;
    } else return;
    e.preventDefault();
  };

  let position = 0;
  return (
    <div ref={rootRef} className={`relative ${props.className}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`Vehicle: ${current ? vehicleName(current) : 'none'}`}
        onClick={() => (open ? close() : show())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            show();
          }
        }}
        className={`flex h-full w-full items-center gap-2 rounded-md border border-(--border) bg-(--surface-1) pl-3 pr-3 text-left transition-colors hover:bg-(--surface-2) ${
          open ? 'bg-(--surface-2)' : ''
        }`}
      >
        <span className="min-w-0 flex-1 truncate">{current ? vehicleName(current) : '—'}</span>
        <svg
          viewBox="0 0 12 12"
          className={`h-3 w-3 shrink-0 text-(--text-muted) transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden
        >
          <path d="M2.5 4.5 6 8l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-label="Vehicle"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          onKeyDown={onListKey}
          className="card absolute top-full z-1050 mt-2 max-h-[min(60vh,24rem)] overflow-auto py-1 shadow-[0_12px_32px_rgba(0,0,0,0.45)] outline-none right-0 w-max min-w-full max-w-[min(18rem,calc(100vw-2rem))]"
        >
          {props.groups.map((g, gi) => (
            <div key={g.label ?? gi} role="group" aria-label={g.label}>
              {g.label && (
                <div
                  className={`px-4 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-(--text-muted) ${
                    gi > 0 ? 'mt-1 border-t border-(--border)' : ''
                  }`}
                >
                  {g.label}
                </div>
              )}
              {g.vehicles.map((v) => {
                const i = position++;
                const selected = v.id === props.value;
                return (
                  <div
                    key={v.id}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={selected}
                    onClick={() => choose(v.id)}
                    onPointerMove={() => setActive(i)}
                    className={`relative flex cursor-pointer items-center gap-3 py-2 pl-4 pr-4 ${
                      i === active ? 'bg-(--surface-2)' : ''
                    }`}
                  >
                    {selected && (
                      <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-(--accent)" />
                    )}
                    <span className={`min-w-0 flex-1 truncate ${selected ? 'font-medium' : ''}`}>
                      {vehicleName(v)}
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
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Two lines, as on rivian.com, turning into a cross. */
function MenuIcon(props: { open: boolean }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden
    >
      {props.open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 9h16M4 15h16" />}
    </svg>
  );
}
