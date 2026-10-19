import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import type { VehicleDto } from '@server/api-types';

interface VehicleGroup {
  /** Shown above the group; left out when there's only one. */
  label?: string;
  vehicles: VehicleDto[];
}

export const vehicleName = (v: VehicleDto) => v.name ?? v.model ?? v.vin;

/** Grouped by where the data comes from, when there's more than one source. */
function vehicleGroups(vehicles: VehicleDto[]): VehicleGroup[] {
  const rivian = vehicles.filter((v) => v.source !== 'teslamate');
  const tesla = vehicles.filter((v) => v.source === 'teslamate');
  return rivian.length > 0 && tesla.length > 0
    ? [
        { label: 'Rivian', vehicles: rivian },
        { label: 'TeslaMate', vehicles: tesla },
      ]
    : [{ vehicles }];
}

/**
 * The vehicle picker, drawn by the app rather than the browser so it matches
 * the rest of the UI. The trigger's look is the caller's (`children`, given
 * whether the list is open); the list drops below it. Arrows move through
 * the list, Enter picks, Escape or a click elsewhere closes it.
 */
export function VehicleMenu(props: {
  vehicles: VehicleDto[];
  value: string | undefined;
  onChange: (id: string) => void;
  /** Classes for the trigger button. */
  className: string;
  children: (open: boolean) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const groups = vehicleGroups(props.vehicles);
  const flat = groups.flatMap((g) => g.vehicles);
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
      // Escape stays inside (an open mobile menu closes on it too).
      if (e.key === 'Escape') e.stopPropagation();
      close(e.key === 'Escape');
      return;
    } else return;
    e.preventDefault();
  };

  let position = 0;
  return (
    <div ref={rootRef} className="relative">
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
        className={`w-full text-left transition-colors hover:bg-(--surface-2) aria-expanded:bg-(--surface-2) ${props.className}`}
      >
        {props.children(open)}
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
          className="card absolute inset-x-0 top-full z-1100 mt-2 max-h-[min(60vh,24rem)] overflow-auto py-1 shadow-[0_12px_32px_rgba(0,0,0,0.45)] outline-none"
        >
          {groups.map((g, gi) => (
            <div key={g.label ?? gi} role="group" aria-label={g.label}>
              {g.label && (
                <div
                  className={`eyebrow px-3 pt-2 pb-1 ${gi > 0 ? 'mt-1 border-t border-(--hairline)' : ''}`}
                >
                  {g.label}
                </div>
              )}
              {g.vehicles.map((v) => {
                const i = position++;
                const selected = v.id === props.value;
                const model = [v.modelYear, v.model].filter(Boolean).join(' ');
                return (
                  <div
                    key={v.id}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={selected}
                    onClick={() => choose(v.id)}
                    onPointerMove={() => setActive(i)}
                    className={`relative flex cursor-pointer items-center gap-3 py-2 pr-3 pl-3 text-sm ${
                      i === active ? 'bg-(--surface-2)' : ''
                    }`}
                  >
                    {selected && (
                      <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-(--accent)" />
                    )}
                    <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                      <span className={`truncate ${selected ? 'font-medium' : ''}`}>
                        {vehicleName(v)}
                      </span>
                      {model && model !== v.name && (
                        <span className="shrink-0 text-xs text-(--text-muted)">{model}</span>
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
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
