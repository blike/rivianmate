import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import type { VehicleDto } from '@server/api-types';
import { useVehicleState } from '../api/hooks';
import { type FreshnessLevel, freshness } from '../lib/freshness';
import {
  ChargingIcon,
  DrivesIcon,
  HealthIcon,
  HistoryIcon,
  OverviewIcon,
  SettingsIcon,
} from './AppIcons';
import { Dot } from './Dot';
import { VehicleMenu, vehicleName } from './VehicleMenu';

export const NAV = [
  { to: '/', label: 'Overview', icon: <OverviewIcon /> },
  { to: '/history', label: 'History', icon: <HistoryIcon /> },
  { to: '/drives', label: 'Drives', icon: <DrivesIcon /> },
  { to: '/charging', label: 'Charging', icon: <ChargingIcon /> },
  { to: '/health', label: 'Health', icon: <HealthIcon /> },
];
const SETTINGS = { to: '/settings', label: 'Settings', icon: <SettingsIcon /> };

/** Matches Tailwind's `lg`, where the sidebar takes over from the top bar. */
const WIDE = '(min-width: 1024px)';

interface NavProps {
  vehicles: VehicleDto[] | undefined;
  vehicleId: string | undefined;
  onSelectVehicle: (id: string) => void;
}

function Wordmark() {
  return (
    <span className="text-[1.25rem] font-semibold tracking-tight">
      Rivian<span className="text-(--accent)">Mate</span>
    </span>
  );
}

/** From `lg` up: brand, the vehicle, and the sections down the left edge. */
export function Sidebar(props: NavProps) {
  return (
    <aside className="sticky top-0 hidden h-screen flex-col border-r border-(--hairline) px-4 pt-6 pb-5 lg:flex">
      <div className="px-2">
        <Wordmark />
      </div>

      <VehicleBlock {...props} />

      <nav aria-label="Main" className="mt-6 flex flex-1 flex-col">
        <ul className="space-y-0.5">
          {NAV.map((item) => (
            <li key={item.to}>
              <SideLink {...item} />
            </li>
          ))}
        </ul>
        <div className="mt-auto border-t border-(--hairline) pt-3">
          <SideLink {...SETTINGS} />
        </div>
      </nav>
    </aside>
  );
}

function SideLink(props: { to: string; label: string; icon: ReactNode }) {
  return (
    <NavLink
      to={props.to}
      end={props.to === '/'}
      className={({ isActive }) =>
        `group relative flex h-9 items-center gap-3 rounded-lg px-2.5 text-sm transition-colors ${
          isActive
            ? 'bg-(--surface-2) text-(--text-primary)'
            : 'text-(--text-secondary) hover:bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] hover:text-(--text-primary)'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <span
            aria-hidden
            className={`absolute top-2 bottom-2 -left-4 w-0.5 rounded-r-full bg-(--accent) transition-opacity ${isActive ? 'opacity-100' : 'opacity-0'}`}
          />
          <span
            className={
              isActive
                ? 'text-(--accent)'
                : 'text-(--text-muted) group-hover:text-(--text-secondary)'
            }
          >
            {props.icon}
          </span>
          {props.label}
        </>
      )}
    </NavLink>
  );
}

const LEVEL_DOT: Record<FreshnessLevel, string> = {
  live: 'var(--status-good)',
  recent: 'var(--text-muted)',
  asleep: 'var(--series-3)',
  stale: 'var(--status-warning)',
};
const LEVEL_WORD: Record<FreshnessLevel, string> = {
  live: 'Online',
  recent: 'Online',
  asleep: 'Asleep',
  stale: 'Not reporting',
};

/** The selected vehicle, its connection, and a picker when there's more than one. */
function VehicleBlock(props: NavProps) {
  const vehicle = props.vehicles?.find((v) => v.id === props.vehicleId);
  const { data: state } = useVehicleState(props.vehicleId);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!vehicle) return <div className="mt-6 h-15" />;
  const f = freshness(state, now);
  const multiple = (props.vehicles?.length ?? 0) > 1;
  const model = [vehicle.modelYear, vehicle.model].filter(Boolean).join(' ');

  const card = (open?: boolean) => (
    <>
      {/* The model sits with the name it belongs to; the state gets its own line. */}
      <span className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-sm font-medium">{vehicle.name ?? vehicle.model}</span>
          {model && model !== vehicle.name && (
            <span className="shrink-0 text-xs text-(--text-muted)">{model}</span>
          )}
        </span>
        {multiple && (
          <Chevron
            className={`shrink-0 text-(--text-muted) transition-transform ${open ? 'rotate-180' : ''}`}
          />
        )}
      </span>
      <span className="mt-1 flex items-center gap-1.5 text-xs text-(--text-secondary)">
        {state && <Dot color={LEVEL_DOT[f.level]} pulse={f.level === 'live'} />}
        <span className="truncate" title={f.label}>
          {state ? LEVEL_WORD[f.level] : ' '}
        </span>
      </span>
    </>
  );
  const frame = 'block rounded-xl border border-(--hairline) bg-(--surface-1) px-3 py-2.5';

  return (
    <div className="mt-6">
      {multiple ? (
        // The card is the control.
        <VehicleMenu
          vehicles={props.vehicles!}
          value={props.vehicleId}
          onChange={props.onSelectVehicle}
          className={`cursor-pointer ${frame}`}
        >
          {card}
        </VehicleMenu>
      ) : (
        <div className={frame}>{card()}</div>
      )}
    </div>
  );
}

/**
 * Below `lg`: brand and a menu button. The menu is a sheet that drops from
 * the top behind the bar, so the bar itself never moves. The sheet sits
 * above map panes and controls (z-index ≤ 1000) and belongs to the page it
 * was opened on, so navigating closes it in the same render as the new page.
 */
export function MobileBar(props: NavProps) {
  const { pathname } = useLocation();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const close = () => setOpenOn(null);
  const menuId = useId();
  const rowRef = useRef<HTMLDivElement>(null);
  // Where the sheet's links start: just under the bar.
  const [sheetTop, setSheetTop] = useState(0);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenOn(null);
    };
    // Widening past the breakpoint shows the sidebar instead.
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

  const multiple = props.vehicles != null && props.vehicles.length > 1;
  const items = [...NAV, SETTINGS];

  return (
    <header className="px-4 py-4 sm:px-6 lg:hidden">
      <div ref={rowRef} className={`flex h-8 items-center ${open ? 'relative z-1100' : ''}`}>
        <Wordmark />
        <button
          type="button"
          className="-mr-1.5 ml-auto grid h-8 w-8 place-items-center rounded-md text-(--text-primary) [-webkit-tap-highlight-color:transparent]"
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
            className="rm-fade-in fixed inset-0 z-1090 bg-black/60"
            onClick={close}
          />
          <div
            id={menuId}
            className="rm-sheet-in fixed inset-x-0 top-0 z-1095 border-b border-(--hairline) bg-(--surface-0) shadow-[0_24px_48px_-24px_rgba(0,0,0,0.9)]"
            style={{ paddingTop: sheetTop + 12 }}
          >
            <nav aria-label="Main" className={`px-4 sm:px-6 ${multiple ? 'pb-5' : 'pb-2'}`}>
              <ul>
                {items.map((item, i) => (
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
                        `flex items-center gap-3 ${i < items.length - 1 ? 'border-b border-(--hairline)' : ''} py-3.5 text-[1rem] font-medium tracking-tight [-webkit-tap-highlight-color:transparent] active:opacity-60 ${
                          isActive ? 'text-(--accent)' : 'text-(--text-primary)'
                        }`
                      }
                    >
                      <span className="opacity-80">{item.icon}</span>
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
              {multiple && (
                <div
                  className="rm-item-in mt-5"
                  style={{ animationDelay: `${40 + items.length * 25}ms` }}
                >
                  <span className="eyebrow mb-1.5 block">Vehicle</span>
                  <VehicleMenu
                    vehicles={props.vehicles!}
                    value={props.vehicleId}
                    onChange={(id) => {
                      props.onSelectVehicle(id);
                      close();
                    }}
                    className="flex h-11 items-center gap-2 rounded-lg border border-(--border) bg-(--surface-1) px-3 text-base"
                  >
                    {(open) => {
                      const current = props.vehicles!.find((v) => v.id === props.vehicleId);
                      return (
                        <>
                          <span className="min-w-0 flex-1 truncate">
                            {current ? vehicleName(current) : '—'}
                          </span>
                          <Chevron
                            className={`shrink-0 text-(--text-muted) transition-transform ${open ? 'rotate-180' : ''}`}
                          />
                        </>
                      );
                    }}
                  </VehicleMenu>
                </div>
              )}
            </nav>
          </div>
        </>
      )}
    </header>
  );
}

function Chevron(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 12 12"
      className={`h-3 w-3 ${props.className ?? ''}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden
    >
      <path d="M2.5 4.5 6 8l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
