import type { CSSProperties } from 'react';
import { useLoading } from '../../components/LoadingState';
import { fmt } from '../../lib/state';

const CELLS = 50;
const SCALE = [0, 25, 50, 75, 100];

/**
 * State of charge as a row of cells, like the pack it stands for: lit to
 * the level, the charge limit marked above, and while charging the cells
 * still to fill ripple toward it. Past the limit the cells are dimmed.
 * Another level can stand in for the limit, named by `limitLabel`.
 */
export function ChargeGauge(props: {
  level: number | null;
  limit: number | null;
  limitLabel?: string;
  charging: boolean;
}) {
  const loading = useLoading();
  const level = loading || props.level == null ? 0 : Math.min(100, Math.max(0, props.level));
  const limit = loading || props.limit == null ? null : Math.min(100, Math.max(0, props.limit));
  const tone = props.charging
    ? 'var(--status-good)'
    : level < 15
      ? 'var(--status-critical)'
      : level < 30
        ? 'var(--status-warning)'
        : 'var(--accent)';
  const lit = (level / 100) * CELLS;

  return (
    <div
      role="meter"
      aria-label="Battery level"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={props.level ?? undefined}
      aria-valuetext={
        props.level != null
          ? `${fmt(props.level, 0)}%${limit != null ? `, ${(props.limitLabel ?? 'Limit').toLowerCase()} ${fmt(limit, 0)}%` : ''}`
          : undefined
      }
      className="charge-gauge relative pt-6"
      style={{ '--gauge': tone } as CSSProperties}
    >
      {limit != null && (
        <div
          aria-hidden
          className="absolute top-0 bottom-5 flex flex-col items-center"
          style={{
            left: `${limit}%`,
            transform: `translateX(${limit < 8 ? '0' : limit > 92 ? '-100%' : '-50%'})`,
          }}
        >
          <span className="text-[11px] leading-4 whitespace-nowrap text-(--text-secondary) tabular-nums">
            {props.limitLabel ?? 'Limit'} {fmt(limit, 0)}%
          </span>
          <span className="mt-1 w-px flex-1 bg-(--text-secondary)" />
        </div>
      )}
      <div className="flex h-5 gap-0.75" aria-hidden>
        {Array.from({ length: CELLS }, (_, i) => {
          const top = ((i + 1) / CELLS) * 100;
          const on = i < Math.floor(lit);
          // The cell the level ends in is lit by how much of it is filled.
          const part = !on && i === Math.floor(lit) ? lit - i : 0;
          const pending = props.charging && !on && limit != null && top <= limit + 0.01;
          const beyond = limit != null && top > limit + 0.01;
          return (
            <span
              key={i}
              className={`charge-gauge__cell ${on ? 'charge-gauge__cell--on' : ''} ${pending ? 'charge-gauge__cell--pending' : ''} ${beyond ? 'charge-gauge__cell--beyond' : ''}`}
              style={
                part > 0
                  ? ({ '--part': `${Math.round(part * 100)}%` } as CSSProperties)
                  : pending
                    ? { animationDelay: `${(i - Math.floor(lit)) * 70}ms` }
                    : undefined
              }
            />
          );
        })}
      </div>
      <div className="relative mt-2 h-3 text-[10.5px] leading-3 text-(--text-muted) tabular-nums">
        {SCALE.map((v) => (
          <span
            key={v}
            className="absolute"
            style={{
              left: `${v}%`,
              transform: `translateX(${v === 0 ? '0' : v === 100 ? '-100%' : '-50%'})`,
            }}
          >
            {v}
          </span>
        ))}
      </div>
    </div>
  );
}
