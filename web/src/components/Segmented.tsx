import type { KeyboardEvent, ReactNode } from 'react';

export interface SegmentedOption<T> {
  value: T;
  label: ReactNode;
  /** Shown on hover, to say what the option means. */
  title?: string;
}

/**
 * A pill of a few options, one chosen: how the app switches between views
 * of the same thing (a metric, a period, units). Arrow keys move the choice.
 */
export function Segmented<T extends string | number>(props: {
  /** Names the group for screen readers. */
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  /** "md" beside larger text, as in a settings row or page header. */
  size?: 'sm' | 'md';
}) {
  const md = props.size === 'md';
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (!step) return;
    e.preventDefault();
    const i = props.options.findIndex((o) => o.value === props.value);
    const next = props.options[(i + step + props.options.length) % props.options.length];
    if (!next) return;
    props.onChange(next.value);
    (e.currentTarget.querySelector(`[data-value="${next.value}"]`) as HTMLElement | null)?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={props.label}
      onKeyDown={onKey}
      className="flex shrink-0 rounded-full border border-(--hairline) bg-(--surface-1) p-0.5"
    >
      {props.options.map((o) => {
        const chosen = o.value === props.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={chosen}
            // One stop in the tab order: the chosen option; arrows move from there.
            tabIndex={chosen ? 0 : -1}
            data-value={o.value}
            title={o.title}
            onClick={() => props.onChange(o.value)}
            className={`rounded-full font-medium whitespace-nowrap tabular-nums transition-colors ${
              md ? 'px-3.5 py-1.5 text-sm' : 'px-2.5 py-1 text-xs'
            } ${
              chosen
                ? 'bg-(--surface-3) text-(--text-primary) shadow-[inset_0_1px_0_rgb(255_255_240/0.06)]'
                : 'text-(--text-muted) hover:text-(--text-primary)'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
