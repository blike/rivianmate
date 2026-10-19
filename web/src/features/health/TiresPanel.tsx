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
import { type TireKey, TIRES, tireTrend } from './health';
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
    </Panel>
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
