import type { ReactNode } from "react";

export interface BarListItem {
  key: string;
  label: string;
  value: number;
  /** The value as shown, with its unit. */
  valueLabel: string;
  sub?: ReactNode;
}

/** Labelled horizontal bars, each scaled to the largest value. */
export function BarList(props: { items: BarListItem[]; color: string }) {
  const max = Math.max(0, ...props.items.map((i) => i.value));
  return (
    <ul className="space-y-3">
      {props.items.map((item) => (
        <li key={item.key} className="text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-[var(--text-secondary)]">{item.label}</span>
            <span className="shrink-0 font-medium tabular-nums">{item.valueLabel}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
            <div
              className="h-full rounded-full"
              style={{ width: `${max > 0 ? (item.value / max) * 100 : 0}%`, background: props.color }}
            />
          </div>
          {item.sub && <div className="mt-1 text-xs text-[var(--text-muted)]">{item.sub}</div>}
        </li>
      ))}
    </ul>
  );
}
