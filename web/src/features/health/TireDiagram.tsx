import type { VehicleState } from '@server/api-types';
import { useUnits } from '../../api/hooks';
import { CarPlan } from '../../components/CarPlan';
import { Skeleton, useLoading } from '../../components/LoadingState';
import { fmt, nv, sv } from '../../lib/state';
import { type TireTrend, TIRES, tireLevel } from './health';
import { LEVEL_COLOR } from './levels';

/** The vehicle from above, with each tire's pressure beside it. */
export function TireDiagram(props: {
  state: VehicleState | undefined;
  trend: TireTrend | null;
  days: number;
  truck?: boolean;
}) {
  const [fl, fr, rl, rr] = TIRES;
  const tire = (t: (typeof TIRES)[number]) => (
    <TireReading tire={t} state={props.state} trend={props.trend} days={props.days} />
  );
  // A tire the vehicle flags, or one losing pressure faster than the rest.
  const attention = new Set(
    TIRES.filter(
      (t) => props.trend?.leaking === t.key || tireLevel(sv(props.state, t.status)) === 'attention',
    ).map((t) => t.key),
  );

  return (
    <div className="mx-auto grid w-full max-w-[16rem] grid-cols-[1fr_auto_1fr] grid-rows-2 items-center gap-x-3 gap-y-6">
      {tire(fl!)}
      <CarPlan className="row-span-2 h-40 w-auto" truck={props.truck} attention={attention} />
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
