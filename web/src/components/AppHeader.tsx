import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import type { VehicleDto } from "@server/api-types.js";

export const NAV = [
  { to: "/", label: "Dashboard" },
  { to: "/history", label: "History" },
  { to: "/drives", label: "Drives" },
  { to: "/charging", label: "Charging" },
  { to: "/health", label: "Health" },
  { to: "/settings", label: "Settings" },
];

/** Matches Tailwind's `md`, where the links and a vehicle picker fit across the header. */
const WIDE = "(min-width: 768px)";

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
      if (e.key === "Escape") setOpenOn(null);
    };
    // Widening past the breakpoint shows the inline links instead.
    const wide = window.matchMedia(WIDE);
    const onWide = () => wide.matches && setOpenOn(null);
    // The page behind stays put while the sheet is open.
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    wide.addEventListener("change", onWide);
    return () => {
      root.style.overflow = overflow;
      document.removeEventListener("keydown", onKey);
      wide.removeEventListener("change", onWide);
    };
  }, [open]);

  const multipleVehicles = props.vehicles != null && props.vehicles.length > 1;
  const vehicleOptions = props.vehicles?.map((v) => (
    <option key={v.id} value={v.id}>
      {v.name ?? v.model ?? v.vin}
    </option>
  ));

  return (
    <header className="py-4">
      {/* One fixed height at every width; above the sheet while it's open. */}
      <div ref={rowRef} className={`flex h-8 items-center gap-4 ${open ? "relative z-1100" : ""}`}>
        <h1 className="text-xl font-semibold leading-8 tracking-tight">
          Rivian<span className="text-[var(--accent)]">Mate</span>
        </h1>

        <nav aria-label="Main" className="hidden h-8 gap-1 md:flex">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `flex h-8 items-center rounded-md px-3 text-sm ${
                  isActive
                    ? "bg-[var(--surface-2)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        {multipleVehicles && (
          <VehicleSelect
            className="ml-auto hidden h-8 text-sm md:block"
            value={props.vehicleId}
            onChange={props.onSelectVehicle}
          >
            {vehicleOptions}
          </VehicleSelect>
        )}

        <button
          type="button"
          className="-mr-1.5 ml-auto grid h-8 w-8 place-items-center rounded-md text-[var(--text-primary)] [-webkit-tap-highlight-color:transparent] md:hidden"
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={open ? "Close menu" : "Open menu"}
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
          <div aria-hidden className="rm-fade-in fixed inset-0 z-1090 bg-black/60 md:hidden" onClick={close} />
          <div
            id={menuId}
            className="rm-sheet-in fixed inset-x-0 top-0 z-1095 border-b border-[var(--border)] bg-[var(--surface-0)] shadow-[0_24px_48px_-24px_rgba(0,0,0,0.9)] md:hidden"
            style={{ paddingTop: sheetTop + 12 }}
          >
            <nav aria-label="Main" className={`mx-auto max-w-6xl px-4 ${multipleVehicles ? "pb-5" : "pb-2"}`}>
              <ul>
                {NAV.map((item, i) => (
                  <li key={item.to} className="rm-item-in" style={{ animationDelay: `${40 + i * 25}ms` }}>
                    <NavLink
                      to={item.to}
                      end={item.to === "/"}
                      // Other pages close the menu by navigating; this one has to.
                      onClick={() => item.to === pathname && close()}
                      className={({ isActive }) =>
                        `flex items-center justify-between ${i < NAV.length - 1 ? "border-b border-[var(--border)]" : ""} py-3.5 text-[1rem] font-semibold tracking-tight [-webkit-tap-highlight-color:transparent] active:opacity-60 ${
                          isActive ? "text-[var(--accent)]" : "text-[var(--text-primary)]"
                        }`
                      }
                    >
                      {item.label}
                      <svg viewBox="0 0 16 16" className="h-4 w-4 text-[var(--text-muted)]" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M6 3.5 10.5 8 6 12.5" />
                      </svg>
                    </NavLink>
                  </li>
                ))}
              </ul>
              {multipleVehicles && (
                <label className="rm-item-in mt-5 block" style={{ animationDelay: `${40 + NAV.length * 25}ms` }}>
                  <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Vehicle</span>
                  <VehicleSelect
                    className="h-11 w-full text-base"
                    value={props.vehicleId}
                    onChange={(id) => {
                      props.onSelectVehicle(id);
                      close();
                    }}
                  >
                    {vehicleOptions}
                  </VehicleSelect>
                </label>
              )}
            </nav>
          </div>
        </>
      )}
    </header>
  );
}

/**
 * A vehicle dropdown with its own chevron: the browser's arrow ignores
 * padding and sits against the edge.
 */
function VehicleSelect(props: { className: string; value: string | undefined; onChange: (id: string) => void; children: ReactNode }) {
  // The width and display classes go on the wrapper, so the chevron follows it.
  return (
    <div className={`relative ${props.className}`}>
      <select
        aria-label="Vehicle"
        className="h-full w-full appearance-none rounded-md border border-[var(--border)] bg-[var(--surface-1)] pl-3 pr-9"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      >
        {props.children}
      </select>
      <svg
        viewBox="0 0 12 12"
        className="pointer-events-none absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--text-muted)]"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden
      >
        <path d="M2.5 4.5 6 8l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/** Two lines, as on rivian.com, turning into a cross. */
function MenuIcon(props: { open: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      {props.open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 9h16M4 15h16" />}
    </svg>
  );
}
