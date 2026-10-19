import type { VehicleState } from '@server/api-types';
import { useUnits } from '../../api/hooks';
import { Row } from '../../components/Panel';
import { Skeleton, useLoading } from '../../components/LoadingState';
import { fmt, nv, sv, titleCase } from '../../lib/state';
import { preconditioningLabel } from '../../lib/vehicleStatus';

/** The cabin as it is and what it's set to, then what's running to get it there. */
export function ClimatePanel(props: { state: VehicleState | undefined }) {
  const s = props.state;
  const u = useUnits();
  const loading = useLoading();
  const interior = nv(s, 'cabinClimateInteriorTemperature');
  const target = nv(s, 'cabinClimateDriverTemperature');
  const precondition = preconditioningLabel(s);
  const active = precondition !== 'Off' && precondition !== 'Unknown';
  const heading =
    active && interior != null && target != null && Math.abs(target - interior) >= 0.5
      ? target > interior
        ? 'Warming'
        : 'Cooling'
      : null;

  return (
    <>
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-[11px] text-(--text-muted)">Cabin</div>
          <div className="mt-1 flex items-start">
            <span className="readout text-[3.25rem] font-light">
              {loading ? <Skeleton className="w-[1.5em]" /> : fmt(u.temperature(interior), 0)}
            </span>
            <span className="readout mt-1 ml-0.5 text-xl text-(--text-muted)">
              {u.temperatureUnit}
            </span>
          </div>
        </div>
        <div className="pb-1 text-right">
          <div className="text-[11px] text-(--text-muted)">Set to</div>
          <div className="mt-1 text-lg font-medium tabular-nums">
            {loading ? <Skeleton className="w-[3em]" /> : u.formatTemperature(target)}
          </div>
          {heading && (
            <div
              className="text-xs"
              style={{ color: heading === 'Warming' ? 'var(--series-4)' : 'var(--series-1)' }}
            >
              {heading}
            </div>
          )}
        </div>
      </div>
      <dl className="mt-5 divide-y divide-(--hairline) border-t border-(--hairline) text-sm [&>div]:py-2.5">
        <Row label="Preconditioning" value={precondition} />
        <Row label="Defrost" value={titleCase(sv(s, 'defrostDefogStatus'))} />
        <Row label="Pet mode" value={titleCase(sv(s, 'petModeStatus'))} />
      </dl>
    </>
  );
}
