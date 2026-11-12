import type { CSSProperties } from 'react';
import { useLoading } from '../../components/LoadingState';
import { fmt } from '../../lib/state';
import type { PowerOutputVerdict } from '../../lib/vehicleStatus';

const CELLS = 50;
const SCALE = [0, 25, 50, 75, 100];

/** The band's only label, and the color it takes: a pack the cold is limiting is not a fault. */
const COLD_LIMITED = 'cold-limited';

/**
 * State of charge as a row of cells, like the pack it stands for: lit to
 * the level, the charge limit marked above, and while charging the cells
 * still to fill ripple toward it. Past the limit the cells are dimmed.
 * Another level can stand in for the limit, named by `limitLabel`. A pack
 * the cold is limiting says so in a row of its own above the limit's
 * label, so the band grows and nothing else moves; a pack the cold is not
 * limiting says nothing, since its verdict is no news.
 */
export function ChargeGauge(props: {
  level: number | null;
  limit: number | null;
  limitLabel?: string;
  charging: boolean;
  /** Null for a vehicle whose battery-state frames don't carry the verdict. */
  verdict?: PowerOutputVerdict | null;
}) {
  const loading = useLoading();
  const level = loading || props.level == null ? 0 : Math.min(100, Math.max(0, props.level));
  const limit = loading || props.limit == null ? null : Math.min(100, Math.max(0, props.limit));
  const coldLimited = !loading && props.verdict === 'cold';
  const tone = props.charging
    ? 'var(--status-good)'
    : level < 15
      ? 'var(--status-critical)'
      : level < 30
        ? 'var(--status-warning)'
        : 'var(--accent)';
  const lit = (level / 100) * CELLS;
  // role="meter" hides the band's own labels, so they are said here instead.
  const valueText =
    props.level != null
      ? [
          `${fmt(props.level, 0)}%`,
          limit != null ? `${(props.limitLabel ?? 'Limit').toLowerCase()} ${fmt(limit, 0)}%` : null,
          coldLimited ? `power output ${COLD_LIMITED}` : null,
        ]
          .filter((part) => part != null)
          .join(', ')
      : undefined;
  // The cold-limited label takes a row of its own above the limit's label, and the band makes room for both.
  const stacked = coldLimited && limit != null;
  // Keeps a band label over the limit's mark, and inside the gauge at either end.
  const marker =
    limit == null
      ? { left: 0 }
      : {
          left: `${limit}%`,
          transform: `translateX(${limit < 8 ? '0' : limit > 92 ? '-100%' : '-50%'})`,
        };

  return (
    <div
      role="meter"
      aria-label="Battery level"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={props.level ?? undefined}
      aria-valuetext={valueText}
      className={`charge-gauge relative ${stacked ? 'pt-10' : 'pt-6'}`}
      style={{ '--gauge': tone } as CSSProperties}
    >
      {coldLimited && (
        <span
          aria-hidden
          className="absolute top-0 text-[11px] leading-4 whitespace-nowrap text-(--status-cold)"
          style={marker}
        >
          {COLD_LIMITED}
        </span>
      )}
      {limit != null && (
        <div
          aria-hidden
          className={`absolute ${stacked ? 'top-4' : 'top-0'} bottom-5 flex flex-col items-center`}
          style={marker}
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
