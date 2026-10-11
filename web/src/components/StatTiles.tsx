import type { ReactNode } from 'react';
import { Skeleton, useLoading } from './LoadingState';

export type StatTile = { label: string; value: ReactNode; sub?: ReactNode };

/**
 * Figures along the bottom of a card, split by hairlines: a label, the
 * value, and a line under it. On phones an odd last tile spans the row.
 */
export function StatTiles(props: {
  tiles: StatTile[];
  /** Column classes above the two-column phone layout, e.g. `sm:grid-cols-3`. */
  columns: string;
}) {
  const loading = useLoading();
  const odd = props.tiles.length % 2 === 1;
  return (
    <ul
      className={`grid grid-cols-2 gap-px border-t border-(--border) bg-(--border) ${props.columns}`}
    >
      {props.tiles.map((t) => (
        <li
          key={t.label}
          className={`bg-(--surface-1) px-4 py-3 ${odd ? 'last:max-sm:col-span-2' : ''}`}
        >
          <div className="text-xs text-(--text-muted)">{t.label}</div>
          <div className="mt-1 text-base font-semibold tabular-nums">
            {loading ? <Skeleton className="w-[5em]" /> : t.value}
          </div>
          <div
            className="truncate text-xs text-(--text-secondary)"
            title={typeof t.sub === 'string' ? t.sub : undefined}
          >
            {loading ? <Skeleton className="w-[7em]" /> : (t.sub ?? ' ')}
          </div>
        </li>
      ))}
    </ul>
  );
}
