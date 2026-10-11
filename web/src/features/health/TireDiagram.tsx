import type { VehicleState } from '@server/api-types';
import { useUnits } from '../../api/hooks';
import { Skeleton, useLoading } from '../../components/LoadingState';
import { fmt, nv, sv } from '../../lib/state';
import { type TireKey, type TireTrend, TIRES, tireLevel } from './health';
import { LEVEL_COLOR } from './levels';

/** Wheel positions in the diagram's 64×128 viewBox. */
const WHEEL_AT: Record<TireKey, [number, number]> = {
  fl: [4, 20],
  fr: [52, 20],
  rl: [4, 84],
  rr: [52, 84],
};

/** The vehicle from above, with each tire's pressure beside it. */
export function TireDiagram(props: {
  state: VehicleState | undefined;
  trend: TireTrend | null;
  days: number;
}) {
  const [fl, fr, rl, rr] = TIRES;
  const tire = (t: (typeof TIRES)[number]) => (
    <TireReading tire={t} state={props.state} trend={props.trend} days={props.days} />
  );
  const color = (t: (typeof TIRES)[number]) => {
    if (props.trend?.leaking === t.key) return LEVEL_COLOR.attention;
    const level = tireLevel(sv(props.state, t.status));
    return level === 'good' ? 'var(--text-secondary)' : LEVEL_COLOR[level];
  };

  return (
    <div className="mx-auto grid w-full max-w-[16rem] grid-cols-[1fr_auto_1fr] grid-rows-2 items-center gap-x-3 gap-y-6">
      {tire(fl!)}
      <svg viewBox="0 0 64 128" className="row-span-2 h-40 w-auto" aria-hidden>
        <rect
          x="10"
          y="4"
          width="44"
          height="120"
          rx="18"
          fill="var(--surface-2)"
          stroke="var(--border)"
        />
        <path d="M16 38 Q32 30 48 38 L46 52 Q32 47 18 52 Z" fill="var(--surface-0)" opacity="0.7" />
        <path
          d="M18 98 Q32 102 46 98 L47 108 Q32 114 17 108 Z"
          fill="var(--surface-0)"
          opacity="0.7"
        />
        {TIRES.map((t) => (
          <rect
            key={t.key}
            x={WHEEL_AT[t.key][0]}
            y={WHEEL_AT[t.key][1]}
            width="8"
            height="24"
            rx="3"
            fill={color(t)}
          />
        ))}
      </svg>
      {tire(fr!)}
      {tire(rl!)}
      {tire(rr!)}
    </div>
  );
}

function TireReading(props: {
  tire: (typeof TIRES)[number];
  state: VehicleState | undefined;
  trend: TireTrend | null;
  days: number;
}) {
  const u = useUnits();
  const loading = useLoading();
  const { tire } = props;
  const bar = nv(props.state, tire.pressure);
  const status = sv(props.state, tire.status);
  const level = tireLevel(status);
  const change = props.trend?.change[tire.key];
  const leaking = props.trend?.leaking === tire.key;
  const digits = u.pressureUnit === 'psi' ? 0 : 2;
  const changeDigits = u.pressureUnit === 'psi' ? 1 : 2;
  const changeText =
    change == null
      ? null
      : Math.abs(u.pressure(change)!) < (u.pressureUnit === 'psi' ? 0.5 : 0.03)
        ? 'Steady'
        : `${change > 0 ? '+' : '−'}${fmt(Math.abs(u.pressure(change)!), changeDigits)} ${u.pressureUnit}`;

  return (
    <div className="text-center">
      <div className="text-xs text-(--text-muted)">{tire.label}</div>
      <div className="mt-0.5 tabular-nums">
        {loading ? (
          <Skeleton className="w-[3em]" />
        ) : bar != null ? (
          <>
            <span
              className="text-xl font-semibold"
              style={level === 'attention' ? { color: LEVEL_COLOR.attention } : undefined}
            >
              {fmt(u.pressure(bar), digits)}
            </span>
            <span className="ml-1 text-xs text-(--text-muted)">{u.pressureUnit}</span>
          </>
        ) : (
          <span className="text-sm" style={{ color: LEVEL_COLOR[level] }}>
            {status ? (level === 'good' ? 'OK' : status) : '—'}
          </span>
        )}
      </div>
      {!loading && level === 'attention' && bar != null && (
        <div className="text-xs text-(--status-warning)">{status}</div>
      )}
      {!loading && changeText && (
        <div
          title={`Change over the last ${props.days} days`}
          className={`text-xs tabular-nums ${leaking ? 'text-(--status-warning)' : 'text-(--text-muted)'}`}
        >
          {changeText}
        </div>
      )}
    </div>
  );
}
