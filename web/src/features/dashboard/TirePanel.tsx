import type { VehicleState } from '@server/api-types';
import { useUnits } from '../../api/hooks';
import { StatusDot } from '../../components/Dot';
import { Skeleton, useLoading } from '../../components/LoadingState';
import { nv, sv } from '../../lib/state';

export function TirePanel(props: { state: VehicleState | undefined }) {
  const s = props.state;
  const u = useUnits();
  const loading = useLoading();
  const corners = [
    {
      label: 'Front left',
      status: 'tirePressureStatusFrontLeft',
      pressure: 'tirePressureFrontLeft',
    },
    {
      label: 'Front right',
      status: 'tirePressureStatusFrontRight',
      pressure: 'tirePressureFrontRight',
    },
    { label: 'Rear left', status: 'tirePressureStatusRearLeft', pressure: 'tirePressureRearLeft' },
    {
      label: 'Rear right',
      status: 'tirePressureStatusRearRight',
      pressure: 'tirePressureRearRight',
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3">
      {corners.map((c) => {
        const status = sv(s, c.status);
        const bar = nv(s, c.pressure);
        return (
          <div key={c.label} className="rounded-md bg-(--surface-2) p-3 text-sm">
            <div className="text-xs text-(--text-muted)">{c.label}</div>
            <div className="mt-1 flex items-center gap-2">
              {loading ? (
                <Skeleton />
              ) : (
                <>
                  <StatusDot ok={status == null ? null : status === 'OK'} />
                  <span className="tabular-nums">
                    {bar != null ? u.formatPressure(bar) : (status ?? '—')}
                  </span>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
