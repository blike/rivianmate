import { fmt } from "../lib/state.js";

export interface SplitSegment {
  key: string;
  label: string;
  kwh: number;
  color: string;
}

/** One full-width bar split into energy shares. */
export function SplitBar(props: { segments: SplitSegment[]; emptyLabel?: string }) {
  const segments = props.segments.filter((s) => s.kwh > 0);
  // Shares of the bar, summing to 100: flex-grow values summing below 1
  // would leave part of the bar empty.
  const total = segments.reduce((sum, s) => sum + s.kwh, 0);
  return (
    <div
      className="parked-bar"
      role="img"
      aria-label={segments.map((s) => `${s.label} ${fmt(s.kwh, 1)} kWh`).join(", ") || props.emptyLabel}
    >
      {segments.map((s) => (
        <div
          key={s.key}
          className="parked-bar__segment"
          style={{ flexGrow: (s.kwh / total) * 100, flexBasis: 0, background: s.color }}
          title={`${s.label}: ${fmt(s.kwh, 1)} kWh`}
        />
      ))}
    </div>
  );
}

/** Colour key for a split bar, with each share's kWh when given. */
export function SplitLegend(props: { items: { key: string; label: string; color: string; kwh?: number }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
      {props.items.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: item.color }} />
          {item.label}
          {item.kwh != null && <span className="tabular-nums text-[var(--text-secondary)]">{fmt(item.kwh, 1)} kWh</span>}
        </li>
      ))}
    </ul>
  );
}
