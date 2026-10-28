import type { VehicleState } from '@server/api-types';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api } from '../../api/client';
import { useUnits } from '../../api/hooks';
import { ContentFrame, LoadingScope } from '../../components/LoadingState';
import { Panel } from '../../components/Panel';
import { TrendChart } from '../../components/TrendChart';
import { vehicleBody } from '../../lib/closures';
import { dateTime, shortDate } from '../../lib/format';
import {
  type CheckLevel,
  type TireKey,
  type TireRotation,
  TIRES,
  tireRotation,
  tireTrend,
} from './health';
import { LEVEL_COLOR } from './levels';
import { TireDiagram } from './TireDiagram';

const WINDOWS = [7, 30, 90] as const;

const TIRE_COLORS: Record<TireKey, string> = {
  fl: 'var(--series-1)',
  fr: 'var(--series-2)',
  rl: 'var(--series-3)',
  rr: 'var(--series-4)',
};

export function TiresPanel(props: {
  vehicleId: string;
  state: VehicleState | undefined;
  statePending: boolean;
  model?: string | null;
}) {
  const [days, setDays] = useState<number>(30);
  const u = useUnits();
  const { data: tires, isPending } = useQuery({
    queryKey: ['tirePressures', props.vehicleId, days],
    queryFn: () => api.tirePressures(props.vehicleId, days),
    refetchInterval: 15 * 60_000,
    placeholderData: keepPreviousData,
  });
  const { data: rotationReading } = useQuery({
    queryKey: ['tireRotation', props.vehicleId],
    queryFn: () => api.tireRotation(props.vehicleId),
    refetchInterval: 15 * 60_000,
  });
  const rotation = tireRotation(rotationReading);

  const points = useMemo(
    () =>
      (tires ?? []).map((t) => ({
        ts: Date.parse(t.ts),
        fl: t.frontLeft,
        fr: t.frontRight,
        rl: t.rearLeft,
        rr: t.rearRight,
      })),
    [tires],
  );
  const trend = useMemo(() => tireTrend(points), [points]);
  const chartData = useMemo(
    () =>
      points.map((p) => ({
        ts: p.ts,
        fl: u.pressure(p.fl),
        fr: u.pressure(p.fr),
        rl: u.pressure(p.rl),
        rr: u.pressure(p.rr),
      })),
    [points, u],
  );
  const digits = u.pressureUnit === 'psi' ? 1 : 2;
  const leaking = trend?.leaking ? TIRES.find((t) => t.key === trend.leaking) : null;

  return (
    <Panel title="Tires" action={<WindowPicker value={days} onChange={setDays} />}>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] md:items-center">
        <LoadingScope loading={props.statePending}>
          <TireDiagram
            state={props.state}
            trend={trend}
            days={days}
            truck={vehicleBody(props.model) === 'truck'}
          />
        </LoadingScope>
        <div className="min-w-0">
          {leaking && (
            <p className="mb-3 text-sm text-(--status-warning)">
              {leaking.label} is losing pressure faster than the others. It may have a slow leak.
            </p>
          )}
          <ContentFrame
            height={200}
            loading={isPending}
            empty={chartData.length === 0}
            emptyText="No tire pressure readings in this window yet."
          >
            <TrendChart
              data={chartData}
              xKey="ts"
              height={200}
              xFormatter={shortDate}
              tooltipLabel={dateTime}
              series={TIRES.map((t) => ({
                key: t.key,
                label: t.label,
                color: TIRE_COLORS[t.key],
                mark: 'line' as const,
                unit: u.pressureUnit,
                digits,
              }))}
            />
          </ContentFrame>
        </div>
      </div>

      {/* Only for a vehicle that reports its wheels' rotation reminder. */}
      {rotation && (
        <div className="mt-6 border-t border-(--border) pt-4">
          <h4 className="mb-3 text-xs uppercase tracking-wide text-(--text-muted)">Rotation</h4>
          <RotationReminder rotation={rotation} />
        </div>
      )}
    </Panel>
  );
}

const ROTATION_FILL: Record<CheckLevel, string> = { ...LEVEL_COLOR, good: 'var(--series-1)' };

function RotationReminder(props: { rotation: TireRotation }) {
  const u = useUnits();
  const r = props.rotation;
  const since = r.sinceKm != null ? `${u.formatDistance(r.sinceKm)} since the last rotation` : null;
  if (r.off) {
    return (
      <>
        <div className="text-xl font-semibold text-(--text-muted)">Reminder off</div>
        <p className="mt-2 text-sm text-(--text-secondary)">
          {since ? `${since}. ` : ''}The vehicle has no rotation interval set.
        </p>
      </>
    );
  }
  // In display units, so under a mile (or km) either way reads as due now.
  const left = u.distance(r.remainingKm);
  const headline =
    left == null
      ? `Due at ${u.formatDistance(r.dueAtKm)}`
      : left >= 1
        ? `Due in ${u.formatDistance(r.remainingKm)}`
        : left <= -1
          ? `Overdue by ${u.formatDistance(-r.remainingKm!)}`
          : 'Due now';
  const pct = r.sinceKm != null ? Math.min(100, (r.sinceKm / r.intervalKm) * 100) : null;
  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div
          className="text-xl font-semibold tabular-nums"
          style={r.level === 'good' ? undefined : { color: LEVEL_COLOR[r.level] }}
        >
          {headline}
        </div>
        <div className="text-sm text-(--text-secondary) tabular-nums">
          Every {u.formatDistance(r.intervalKm)}
          {r.remainingKm != null && ` · due at ${u.formatDistance(r.dueAtKm)}`}
        </div>
      </div>
      {pct != null && (
        <div
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-(--surface-2)"
          role="meter"
          aria-label="Distance since the last rotation, against the interval"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
        >
          <div
            className="h-full rounded-full"
            style={{ width: `${pct}%`, background: ROTATION_FILL[r.level] }}
          />
        </div>
      )}
      {since && <p className="mt-2 text-sm text-(--text-secondary) tabular-nums">{since}</p>}
    </>
  );
}

function WindowPicker(props: { value: number; onChange: (days: number) => void }) {
  return (
    <div className="flex shrink-0 rounded-md border border-(--border) p-0.5">
      {WINDOWS.map((d) => (
        <button
          key={d}
          onClick={() => props.onChange(d)}
          className={`rounded px-2.5 py-1 text-xs ${
            d === props.value
              ? 'bg-(--surface-2) text-(--text-primary)'
              : 'text-(--text-secondary) hover:text-(--text-primary)'
          }`}
        >
          {d}d
        </button>
      ))}
    </div>
  );
}
