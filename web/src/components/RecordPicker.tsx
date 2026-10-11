import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface PickerItem {
  id: number;
  /** Start time, e.g. "2:42 PM". */
  time: string;
  title: string;
  /** Secondary line, e.g. duration and efficiency. */
  detail?: string;
  /** Headline figure on the right, e.g. distance or energy. */
  value?: string;
  /** Still under way. */
  live?: boolean;
}

export interface PickerGroup {
  key: string;
  label: string;
  /** The day's totals, shown beside its label. */
  summary?: string;
  items: PickerItem[];
}

/**
 * Picks one record (a drive, a session) from a list grouped by day, for
 * screens too narrow to show the list beside the details. Arrows step
 * through the list in its order (newest first): right moves down it, to
 * older records; the middle opens the list.
 */
export function RecordPicker(props: {
  label: string;
  groups: PickerGroup[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  // Newest first, as listed.
  const flat = props.groups.flatMap((g) => g.items.map((item) => ({ ...item, day: g.label })));
  const index = flat.findIndex((item) => item.id === props.selectedId);
  const current = flat[index];
  const newer = index > 0 ? flat[index - 1] : undefined;
  const older = index >= 0 ? flat[index + 1] : undefined;

  const show = () => {
    setActive(Math.max(index, 0));
    setOpen(true);
  };
  const close = (refocus = false) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };
  const choose = (id: number) => {
    props.onSelect(id);
    close(true);
  };

  // Close on a tap or click anywhere else.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // Opening focuses the list, scrolled to the chosen record.
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    list?.focus({ preventScroll: true });
    list?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "center" });
  }, [open]);

  // Keyboard focus follows the active option.
  useEffect(() => {
    if (open && active >= 0) listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const onListKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") setActive((i) => Math.min(i + 1, flat.length - 1));
    else if (e.key === "ArrowUp") setActive((i) => Math.max(i - 1, 0));
    else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(flat.length - 1);
    else if (e.key === "Enter" || e.key === " ") {
      if (flat[active]) choose(flat[active].id);
    } else if (e.key === "Escape" || e.key === "Tab") {
      close(e.key === "Escape");
      return;
    } else return;
    e.preventDefault();
  };

  let position = 0;
  return (
    <div ref={rootRef} className={props.className}>
      <div className="relative">
        <div className="card flex items-stretch overflow-hidden bg-[color-mix(in_srgb,var(--surface-1)_88%,transparent)] backdrop-blur">
          <StepButton label={`Newer ${props.label.toLowerCase()}`} disabled={!newer} onClick={() => newer && props.onSelect(newer.id)}>
            <path d="M10 3.5 5.5 8l4.5 4.5" />
          </StepButton>
          <button
            ref={triggerRef}
            type="button"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-label={`${props.label}: ${current ? `${current.day}, ${current.time}, ${current.title}` : "none"}`}
            onClick={() => (open ? close() : show())}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                show();
              }
            }}
            className={`flex min-w-0 flex-1 items-center gap-2 border-x border-[var(--border)] px-3 py-2 text-left transition-colors hover:bg-[var(--surface-2)] ${
              open ? "bg-[var(--surface-2)]" : ""
            }`}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                {current ? `${current.day} · ${index + 1} of ${flat.length}` : props.label}
              </span>
              <span className="block truncate text-sm font-medium">
                {current ? [current.time, current.title, current.value].filter(Boolean).join(" · ") : "—"}
              </span>
            </span>
            <svg
              viewBox="0 0 12 12"
              className={`h-3 w-3 shrink-0 text-[var(--text-muted)] transition-transform ${open ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden
            >
              <path d="M2.5 4.5 6 8l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <StepButton label={`Older ${props.label.toLowerCase()}`} disabled={!older} onClick={() => older && props.onSelect(older.id)}>
            <path d="M6 3.5 10.5 8 6 12.5" />
          </StepButton>
        </div>

        {open && (
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-label={props.label}
            aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
            onKeyDown={onListKey}
            className="card absolute inset-x-0 top-full z-30 mt-2 max-h-[min(60vh,28rem)] overflow-auto shadow-[0_12px_32px_rgba(0,0,0,0.45)] outline-none"
          >
            {props.groups.map((g) => (
              <div key={g.key} role="group" aria-label={g.label}>
                <div className="sticky top-0 z-10 flex items-baseline justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-1)] px-4 py-2 text-xs">
                  <span className="font-medium uppercase tracking-wide text-[var(--text-muted)]">{g.label}</span>
                  {g.summary && <span className="tabular-nums text-[var(--text-muted)]">{g.summary}</span>}
                </div>
                {g.items.map((item) => {
                  const i = position++;
                  const selected = item.id === props.selectedId;
                  return (
                    <div
                      key={item.id}
                      id={`${listId}-${i}`}
                      data-index={i}
                      role="option"
                      aria-selected={selected}
                      onClick={() => choose(item.id)}
                      onPointerMove={() => setActive(i)}
                      className={`relative grid cursor-pointer grid-cols-[4.25rem_minmax(0,1fr)_auto] items-baseline gap-x-3 px-4 py-2.5 ${
                        selected || i === active ? "bg-[var(--surface-2)]" : ""
                      }`}
                    >
                      {selected && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-[var(--accent)]" />}
                      <span className="text-xs tabular-nums text-[var(--text-muted)]">{item.time}</span>
                      <span className="min-w-0">
                        <span className={`block truncate text-sm ${selected ? "font-medium" : ""}`}>{item.title}</span>
                        {(item.detail || item.live) && (
                          <span className="mt-0.5 block truncate text-xs tabular-nums text-[var(--text-muted)]">
                            {item.live && <span className="text-[var(--status-good)]">In progress{item.detail ? " · " : ""}</span>}
                            {item.detail}
                          </span>
                        )}
                      </span>
                      {item.value && <span className="text-sm font-medium tabular-nums">{item.value}</span>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StepButton(props: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
      className="grid w-11 shrink-0 place-items-center text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)] disabled:opacity-30 disabled:hover:bg-transparent"
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {props.children}
      </svg>
    </button>
  );
}
