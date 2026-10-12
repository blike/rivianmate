import type { BatteryHealthDto, VehicleInsightsDto } from '@server/api-types';
import { useMemo, type ReactNode } from 'react';
import { ContentFrame, LoadingScope, Skeleton, useLoading } from '../../components/LoadingState';
import { Panel } from '../../components/Panel';
import { ParkedEnergyPanel } from '../../components/ParkedEnergyPanel';
import { TrendChart } from '../../components/TrendChart';
import { longDateTime, shortDate } from '../../lib/format';
import { fmt } from '../../lib/state';
import { capacityTrend, capacityOfRated } from './health';

export function BatteryPanel(props: {
  battery: BatteryHealthDto | undefined;
  insights: VehicleInsightsDto | undefined;
  batteryPending: boolean;
  insightsPending: boolean;
  /** Show energy used while parked (Rivian reports it). */
  parkedEnergy: boolean;
}) {
  const reported = props.battery?.reported;
  const latest = props.battery?.latest;
  const rated = props.battery?.ratedCapacity?.kwh ?? null;
  const trend = capacityTrend([...(reported ?? []), ...(latest ? [latest] : [])]);
  const ofRated = capacityOfRated(trend?.latestKwh, rated);
  const chartData = useMemo(
    () => (reported ?? []).map((r) => ({ ts: Date.parse(r.at), kwh: r.kwh, rated })),
    [reported, rated],
  );

  return (
    <Panel title="Battery">
      <div className="grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <LoadingScope loading={props.batteryPending}>
          <div className="min-w-0">
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
              <BigStat
                label="Usable capacity"
                value={trend ? fmt(trend.latestKwh, 1) : '—'}
                unit="kWh"
              />
              <div className="pb-1 text-sm text-(--text-secondary)">
                <CapacityChange changeKwh={trend?.changeKwh ?? null} since={trend?.since ?? null} />
              </div>
            </div>
            <div className="mt-4">
              <ContentFrame
                height={180}
                loading={props.batteryPending}
                empty={chartData.length === 0}
                emptyText="No capacity readings recorded yet."
              >
                <TrendChart
                  data={chartData}
                  xKey="ts"
                  height={180}
                  xFormatter={shortDate}
                  tooltipLabel={longDateTime}
                  series={[
                    {
                      key: 'kwh',
                      label: 'Usable capacity',
                      color: 'var(--series-2)',
                      mark: 'area',
                      dots: chartData.length < 20,
                      unit: 'kWh',
                      digits: 1,
                    },
                    ...(rated != null && chartData.length > 1
                      ? [
                          {
                            key: 'rated',
                            label: 'Rated',
                            color: 'var(--text-muted)',
                            mark: 'line' as const,
                            dashed: true,
                            unit: 'kWh',
                            digits: 1,
                          },
                        ]
                      : []),
                  ]}
                />
              </ContentFrame>
            </div>
          </div>
        </LoadingScope>

        <div className="min-w-0 space-y-5">
          <LoadingScope loading={props.batteryPending}>
            <div>
              <BigStat
                label="Capacity vs rated"
                value={ofRated != null ? fmt(ofRated, 1) : '—'}
                unit={ofRated != null ? '%' : ''}
              />
              <CapacityBar pct={ofRated} />
              <p className="mt-2 text-sm text-(--text-secondary)">
                {ofRated != null && rated != null
                  ? `${fmt(trend!.latestKwh, 1)} of ${fmt(rated, 1)} kWh rated`
                  : 'Shown once the vehicle reports its rated capacity.'}
              </p>
            </div>
          </LoadingScope>
          {props.parkedEnergy && (
            <div className="border-t border-(--border) pt-4">
              <h4 className="mb-3 text-xs uppercase tracking-wide text-(--text-muted)">
                Used while parked
              </h4>
              <LoadingScope loading={props.insightsPending}>
                <ParkedEnergyPanel insights={props.insights} />
              </LoadingScope>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

/** Capacity against rated, as a filled track. */
function CapacityBar(props: { pct: number | null }) {
  const loading = useLoading();
  const filled = props.pct != null ? Math.min(100, props.pct) : 0;
  return (
    <div
      className="mt-3 h-1.5 overflow-hidden rounded-full bg-(--surface-2)"
      role="meter"
      aria-label="Capacity against rated"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={loading || props.pct == null ? undefined : Math.round(filled)}
    >
      {!loading && props.pct != null && (
        <div className="h-full rounded-full bg-(--series-2)" style={{ width: `${filled}%` }} />
      )}
    </div>
  );
}

function BigStat(props: { label: string; value: ReactNode; unit: string }) {
  const loading = useLoading();
  return (
    <div>
      <div className="text-xs text-(--text-muted)">{props.label}</div>
      <div className="mt-0.5 text-3xl font-semibold tabular-nums tracking-tight">
        {loading ? <Skeleton className="w-[4em]" /> : props.value}
        {props.unit && (
          <span className="ml-1.5 text-base font-normal text-(--text-muted)">{props.unit}</span>
        )}
      </div>
    </div>
  );
}

function CapacityChange(props: { changeKwh: number | null; since: string | null }): ReactNode {
  const loading = useLoading();
  if (loading) return <Skeleton className="w-[10em]" />;
  if (props.changeKwh == null || !props.since)
    return <span className="text-(--text-muted)">Tracking from today</span>;
  const since = new Date(props.since).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  if (Math.abs(props.changeKwh) < 0.5) return <>Steady since {since}</>;
  return (
    <>
      <span className="tabular-nums">
        {props.changeKwh > 0 ? '+' : '−'}
        {fmt(Math.abs(props.changeKwh), 1)} kWh
      </span>{' '}
      since {since}
    </>
  );
}
