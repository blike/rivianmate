import { useMemo } from 'react';
import { useUnits } from '../../api/hooks';
import { ContentFrame, useLoading } from '../../components/LoadingState';
import { Panel } from '../../components/Panel';
import { TrendChart } from '../../components/TrendChart';
import { dateTime } from '../../lib/format';
import { distanceByPeriod } from './history';

export function DistancePanel(props: {
  drives: Parameters<typeof distanceByPeriod>[0];
  from: Date;
  to: Date;
  hours: number;
}) {
  const u = useUnits();
  const loading = useLoading();
  const unit = props.hours <= 24 ? 'hour' : 'day';
  const buckets = useMemo(
    () => distanceByPeriod(props.drives, props.from.getTime(), props.to.getTime(), unit),
    [props.drives, props.from, props.to, unit],
  );
  const data = useMemo(() => buckets.map((b, i) => ({ i, km: u.distance(b.km) })), [buckets, u]);
  const label = (i: number) => {
    const ts = buckets[i]?.ts;
    if (ts == null) return '';
    return unit === 'hour'
      ? new Date(ts).toLocaleTimeString([], { hour: 'numeric' })
      : new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
  };
  const busiest = buckets.reduce<(typeof buckets)[number] | null>(
    (best, b) => (b.km > (best?.km ?? 0) ? b : best),
    null,
  );

  return (
    <Panel
      title={unit === 'hour' ? 'Distance by hour' : 'Distance by day'}
      action={
        busiest && !loading ? (
          <span className="text-xs text-(--text-muted)">
            Busiest{' '}
            {unit === 'hour'
              ? new Date(busiest.ts).toLocaleTimeString([], { hour: 'numeric' })
              : new Date(busiest.ts).toLocaleDateString([], {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}{' '}
            · {u.formatDistance(busiest.km)}
          </span>
        ) : undefined
      }
    >
      <ContentFrame
        height={160}
        loading={loading}
        empty={!busiest}
        emptyText="No drives in this period."
      >
        <TrendChart
          data={data}
          xKey="i"
          xType="category"
          height={160}
          leftDomain={[0, 'auto']}
          xFormatter={label}
          tooltipLabel={(i) => {
            const ts = buckets[i]?.ts;
            if (ts == null) return '';
            return unit === 'hour'
              ? dateTime(ts)
              : new Date(ts).toLocaleDateString([], {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                });
          }}
          series={[
            {
              key: 'km',
              label: 'Distance',
              color: 'var(--accent)',
              mark: 'bar',
              unit: u.distanceUnit,
              digits: 0,
            },
          ]}
        />
      </ContentFrame>
    </Panel>
  );
}
