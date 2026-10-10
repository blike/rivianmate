import type { ReactNode } from "react";

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
    <section aria-label={props.ariaLabel} className={`min-w-0 ${props.className ?? ""}`}>
      {(props.title || props.action) && (
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-1">
          {props.title && <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">{props.title}</h3>}
          {props.action}
        </div>
      )}
      <div className="card divide-y divide-[var(--border)]">{props.children}</div>
      {props.note && <p className="mt-2 px-1 text-xs text-[var(--text-muted)]">{props.note}</p>}
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
          {props.description && <div className="mt-0.5 text-xs text-[var(--text-muted)]">{props.description}</div>}
        </div>
        {props.children != null && <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{props.children}</div>}
      </div>
      {props.below}
    </div>
  );
}

/** A big status line for the top of a section: eyebrow, headline, detail. */
export function SettingsHero(props: {
  eyebrow: ReactNode;
  tone?: "good" | "warning" | "critical" | "muted" | "accent";
  pulse?: boolean;
  headline: ReactNode;
  detail?: ReactNode;
  children?: ReactNode;
}) {
  const color = {
    good: "var(--status-good)",
    warning: "var(--status-warning)",
    critical: "var(--status-critical)",
    muted: "var(--text-muted)",
    accent: "var(--accent)",
  }[props.tone ?? "muted"];
  return (
    <section className="card overflow-hidden">
      <div className="p-5">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide" style={{ color }}>
          <span
            aria-hidden
            className={`h-1.5 w-1.5 rounded-full ${props.pulse ? "chip-dot--pulse" : ""}`}
            style={{ background: color, color }}
          />
          {props.eyebrow}
        </div>
        <div className="mt-1.5 text-2xl font-semibold tracking-tight">{props.headline}</div>
        {props.detail && <div className="mt-1 text-sm text-[var(--text-secondary)]">{props.detail}</div>}
      </div>
      {props.children}
    </section>
  );
}

/** Figures along the bottom of a hero, split by hairlines. */
export function HeroTiles(props: { tiles: { label: string; value: ReactNode; tone?: "critical" }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-px border-t border-[var(--border)] bg-[var(--border)] sm:grid-cols-4">
      {props.tiles.map((t) => (
        <div key={t.label} className="bg-[var(--surface-1)] px-5 py-3">
          <dt className="text-xs text-[var(--text-muted)]">{t.label}</dt>
          <dd
            className="mt-0.5 text-lg font-semibold tabular-nums"
            style={t.tone === "critical" ? { color: "var(--status-critical)" } : undefined}
          >
            {t.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function SegmentedControl<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={props.label} className="flex rounded-lg bg-[var(--surface-2)] p-0.5 text-sm">
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === props.value}
          className={`rounded-md px-3 py-1 transition-colors ${
            o.value === props.value
              ? "bg-[var(--accent)] font-medium text-[var(--on-accent)]"
              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch(props: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      onClick={() => props.onChange(!props.checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
        props.checked ? "bg-[var(--accent)]" : "bg-[var(--border)]"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
          props.checked ? "translate-x-[18px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

/** The quiet outlined button used for secondary actions in settings. */
export const secondaryButton =
  "rounded-md border border-[color-mix(in_srgb,var(--border)_60%,var(--text-muted))] bg-[var(--surface-2)] px-3 py-1.5 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[color-mix(in_srgb,var(--surface-2)_75%,var(--text-muted))] disabled:opacity-50 disabled:hover:bg-[var(--surface-2)]";

export const dangerButton =
  "rounded-md border border-[color-mix(in_srgb,var(--status-critical)_55%,var(--border))] bg-[color-mix(in_srgb,var(--status-critical)_10%,var(--surface-1))] px-3 py-1.5 text-sm font-medium text-[var(--status-critical)] transition-colors hover:bg-[color-mix(in_srgb,var(--status-critical)_20%,var(--surface-1))]";
