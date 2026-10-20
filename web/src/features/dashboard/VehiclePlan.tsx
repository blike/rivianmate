import type { VehicleDto, VehicleState } from '@server/api-types';
import { useUnits } from '../../api/hooks';
import { CarPlan, type WheelKey } from '../../components/CarPlan';
import { Skeleton, useLoading } from '../../components/LoadingState';
import { RenderPlan } from '../../components/RenderPlan';
import { closureStatuses, vehicleBody } from '../../lib/closures';
import { fmt, nv, sv } from '../../lib/state';
import { securitySummary } from '../../lib/vehicleStatus';
import { TIRES, tireLevel } from '../health/health';

/**
 * The vehicle from above, in Rivian's render where there is one: closures
 * glow where something is open, a tire glows when it needs attention, and the
 * pressures stand beside the wheels.
 */
export function VehiclePlan(props: {
  state: VehicleState | undefined;
  vehicle?: VehicleDto;
  /** Whether the source reports doors and windows (TeslaMate doesn't). */
  closures?: boolean;
}) {
  const closuresKnown = props.closures ?? true;
  const loading = useLoading();
  const s = props.state;
  const model = props.vehicle?.model;
  const { closures, windows } = closureStatuses(s, model);
  const open = new Set(
    closuresKnown ? [...closures, ...windows].filter((c) => !c.closed).map((c) => c.key) : [],
  );
  const security = securitySummary(s, model);
  const truck = vehicleBody(model) === 'truck';
  const render = props.vehicle?.renders?.includes('overhead')
    ? `/api/vehicles/${props.vehicle.id}/render/overhead`
    : null;
  const [fl, fr, rl, rr] = TIRES;

  const attention = new Set<WheelKey>(
    TIRES.filter((t) => tireLevel(sv(s, t.status)) === 'attention').map((t) => t.key),
  );

  const plan = {
    className: 'row-span-2 h-72 w-auto sm:h-80',
    attention: loading ? undefined : attention,
    open: loading ? undefined : open,
    truck,
    label:
      loading || !closuresKnown
        ? 'Vehicle'
        : `Vehicle from above. ${security.openLabel}${security.locked == null ? '' : security.locked ? ', locked' : ', unlocked'}.`,
  };

  return (
    // Fills its card: the plan centers in the height, the status line keeps to the foot.
    <div className="flex flex-1 flex-col">
      <div className="mx-auto my-auto grid w-full max-w-sm grid-cols-[1fr_auto_1fr] grid-rows-2 items-center gap-x-4 sm:gap-x-6">
        <Tire tire={fl!} state={s} align="right" />
        {render ? <RenderPlan src={render} {...plan} /> : <CarPlan {...plan} />}
        <Tire tire={fr!} state={s} align="left" />
        <Tire tire={rl!} state={s} align="right" />
        <Tire tire={rr!} state={s} align="left" />
      </div>

      {/* Left out when there's nothing to say: no closures and no lock state. */}
      {(closuresKnown || security.locked !== null) && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 border-t border-(--hairline) pt-4 text-sm">
          {loading ? (
            <Skeleton className="w-[12em]" />
          ) : (
            <>
              {security.locked !== null && (
                <span
                  className={
                    security.locked ? 'text-(--text-secondary)' : 'text-(--status-warning)'
                  }
                >
                  {security.locked ? 'Locked' : 'Unlocked'}
                </span>
              )}
              {closuresKnown && (
                <span
                  className={
                    security.open.length ? 'text-(--status-warning)' : 'text-(--text-secondary)'
                  }
                >
                  {security.open.length === 0
                    ? 'Everything closed'
                    : `${security.open.join(', ')} open`}
                </span>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Tire(props: {
  tire: (typeof TIRES)[number];
  state: VehicleState | undefined;
  align: 'left' | 'right';
}) {
  const u = useUnits();
  const loading = useLoading();
  const bar = nv(props.state, props.tire.pressure);
  const status = sv(props.state, props.tire.status);
  const level = tireLevel(status);
  return (
    <div className={props.align === 'right' ? 'text-right' : 'text-left'}>
      <div className="text-[11px] text-(--text-muted)">{props.tire.label}</div>
      <div className="mt-1">
        {loading ? (
          <Skeleton className="w-[2.5em] text-2xl" />
        ) : bar != null ? (
          <>
            <span
              className="readout text-[2rem] font-[350]"
              style={level === 'attention' ? { color: 'var(--status-warning)' } : undefined}
            >
              {fmt(u.pressure(bar), u.pressureUnit === 'psi' ? 0 : 2)}
            </span>
            <span className="ml-1 text-xs text-(--text-muted)">{u.pressureUnit}</span>
          </>
        ) : (
          <span
            className="text-sm"
            style={{ color: level === 'attention' ? 'var(--status-warning)' : undefined }}
          >
            {status ? (level === 'good' ? 'OK' : status) : '—'}
          </span>
        )}
      </div>
      {!loading && level === 'attention' && bar != null && (
        <div className="text-xs text-(--status-warning)">{status}</div>
      )}
    </div>
  );
}
