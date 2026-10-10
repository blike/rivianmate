import type { ReactNode } from "react";

export interface PickerGroup {
  key: string;
  label: string;
  items: { id: number; label: string }[];
}

/**
 * Picks one record (a drive, a session) from a list grouped by day, for
 * screens too narrow to show the list beside the details. Arrows step to
 * the neighbors; the middle opens the platform's own picker.
 */
export function RecordPicker(props: {
  label: string;
  groups: PickerGroup[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  className?: string;
}) {
  // Newest first, as listed.
  const flat = props.groups.flatMap((g) => g.items.map((item) => ({ ...item, day: g.label })));
  const index = flat.findIndex((item) => item.id === props.selectedId);
  const current = flat[index];
  const newer = index > 0 ? flat[index - 1] : undefined;
  const older = index >= 0 ? flat[index + 1] : undefined;

  return (
    <div
      className={`card flex items-stretch overflow-hidden bg-[color-mix(in_srgb,var(--surface-1)_88%,transparent)] backdrop-blur ${props.className ?? ""}`}
    >
      <StepButton label={`Older ${props.label.toLowerCase()}`} disabled={!older} onClick={() => older && props.onSelect(older.id)}>
        <path d="M10 3.5 5.5 8l4.5 4.5" />
      </StepButton>
      <label className="relative flex min-w-0 flex-1 cursor-pointer items-center gap-2 border-x border-[var(--border)] px-3 py-2 hover:bg-[var(--surface-2)]">
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
            {current ? `${current.day} · ${index + 1} of ${flat.length}` : props.label}
          </span>
          <span className="block truncate text-sm font-medium">{current?.label ?? "—"}</span>
        </span>
        <svg viewBox="0 0 12 12" className="h-3 w-3 shrink-0 text-[var(--text-muted)]" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <path d="M2.5 4.5 6 8l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {/* Invisible over the label, so a tap opens the native picker. */}
        <select
          aria-label={props.label}
          value={props.selectedId ?? ""}
          onChange={(e) => props.onSelect(Number(e.target.value))}
          className="absolute inset-0 cursor-pointer opacity-0"
        >
          {props.groups.map((g) => (
            <optgroup key={g.key} label={g.label}>
              {g.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <StepButton label={`Newer ${props.label.toLowerCase()}`} disabled={!newer} onClick={() => newer && props.onSelect(newer.id)}>
        <path d="M6 3.5 10.5 8 6 12.5" />
      </StepButton>
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
