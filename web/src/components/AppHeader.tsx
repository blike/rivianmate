import { useEffect, useId, useRef, useState } from "react";
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

/** The nav item for a path ("/" only matches exactly). */
export function currentNavItem(pathname: string) {
  return NAV.find((item) =>
    item.to === "/" ? pathname === "/" : pathname === item.to || pathname.startsWith(`${item.to}/`),
  );
}

/**
 * Brand, navigation and vehicle picker. Below `md` the navigation collapses
 * into a menu button labelled with the current page; the open menu floats
 * over the page (above Leaflet's panes and controls, z-index ≤ 1000) with
 * a backdrop, so nothing below it moves.
 */
export function AppHeader(props: {
  vehicles: VehicleDto[] | undefined;
  vehicleId: string | undefined;
  onSelectVehicle: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const menuId = useId();
  const headerRef = useRef<HTMLElement>(null);
  const current = currentNavItem(pathname);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointer = (e: PointerEvent) => {
      if (!headerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const vehiclePicker = (className: string) =>
    props.vehicles && props.vehicles.length > 1 ? (
      <select
        aria-label="Vehicle"
        className={`rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-sm ${className}`}
        value={props.vehicleId}
        onChange={(e) => {
          props.onSelectVehicle(e.target.value);
          setOpen(false);
        }}
      >
        {props.vehicles.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name ?? v.model ?? v.vin}
          </option>
        ))}
      </select>
    ) : null;

  return (
    <header ref={headerRef} className="relative py-4">
      {/* Above the backdrop, so the brand and close button stay undimmed. */}
      <div className={`flex items-center gap-4 ${open ? "relative z-1100" : ""}`}>
        <h1 className="text-xl font-semibold tracking-tight">
          Rivian<span className="text-[var(--accent)]">Mate</span>
        </h1>

        <nav aria-label="Main" className="hidden gap-1 md:flex">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `rounded-md px-3 py-1.5 text-sm ${
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
        {vehiclePicker("ml-auto hidden md:block")}

        <button
          type="button"
          className="ml-auto flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-primary)] md:hidden"
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((o) => !o)}
        >
          <span>{current?.label ?? "Menu"}</span>
          <MenuIcon open={open} />
        </button>
      </div>

      {open && (
        <div
          aria-hidden
          className="fixed inset-0 z-1090 bg-black/50 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}
      {open && (
        <nav
          id={menuId}
          aria-label="Main"
          className="card absolute inset-x-0 top-full z-1100 -mt-1 flex flex-col gap-1 p-2 shadow-[0_16px_48px_-12px_rgba(0,0,0,0.8)] md:hidden"
        >
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `rounded-md px-3 py-2.5 text-base ${
                  isActive
                    ? "bg-[var(--surface-2)] font-medium text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] active:bg-[var(--surface-2)]"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
          {vehiclePicker("mx-1 mt-1 py-2 text-base")}
        </nav>
      )}
    </header>
  );
}

function MenuIcon(props: { open: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      {props.open ? (
        <path d="M6 6l12 12M18 6L6 18" />
      ) : (
        <path d="M4 7h16M4 12h16M4 17h16" />
      )}
    </svg>
  );
}
