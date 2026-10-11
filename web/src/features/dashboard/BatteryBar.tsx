import { useLoading } from '../../components/LoadingState';
import { fmt } from '../../lib/state';

/** State of charge with the charge limit marked; shimmers while charging. */
export function BatteryBar(props: {
  level: number | null;
  limit: number | null;
  charging: boolean;
}) {
  const loading = useLoading();
  const level = loading || props.level == null ? 0 : Math.min(100, Math.max(0, props.level));
  const tone = props.charging ? 'charging' : level < 15 ? 'low' : level < 30 ? 'warn' : 'ok';
  return (
    <div className="mt-4">
      <div
        className="battery-bar"
        role="meter"
        aria-label="Battery level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={props.level ?? undefined}
      >
        <div
          className={`battery-bar__fill battery-bar__fill--${tone}`}
          style={{ width: `${level}%` }}
        />
        {props.limit != null && !loading && (
          <div className="battery-bar__limit" style={{ left: `${Math.min(100, props.limit)}%` }} />
        )}
      </div>
      <div className="relative mt-1.5 h-4 text-[11px] text-(--text-muted)">
        {/* Centered under the tick, but kept inside the bar near either end. */}
        {props.limit != null && !loading && (
          <span
            className="absolute whitespace-nowrap"
            style={{
              left: `${Math.min(100, props.limit)}%`,
              transform: `translateX(${props.limit < 15 ? '0' : props.limit > 85 ? '-100%' : '-50%'})`,
            }}
          >
            Limit {fmt(props.limit, 0)}%
          </span>
        )}
      </div>
    </div>
  );
}
