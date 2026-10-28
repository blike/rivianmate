import { useMemo, useState, type ReactNode } from 'react';
import { useUnits } from '../../api/hooks';
import { Skeleton, SkeletonBlock, useLoading } from '../../components/LoadingState';
import { formatMoney } from '../../lib/charging';
import { shortDate } from '../../lib/format';
import { fmt, fmtSeconds } from '../../lib/state';
import { distanceByPeriod, periodSummary } from './history';

/**
 * The period at a glance: how far, as a figure and day by day, then what
 * else it took.
 */
export function SummaryCard(props: {
  summary: ReturnType<typeof periodSummary>;
  drives: Parameters<typeof distanceByPeriod>[0];
  from: Date;
  to: Date;
  hours: number;
}) {
  const u = useUnits();
  const loading = useLoading();
  const s = props.summary;
  // A bar a day, until there are too many to see: a year is a bar a week.
  const unit = props.hours > 24 * 90 ? 'week' : 'day';
  const buckets = useMemo(
    () => distanceByPeriod(props.drives, props.from.getTime(), props.to.getTime(), unit),
    [props.drives, props.from, props.to, unit],
  );
  const most = Math.max(0, ...buckets.map((b) => b.km));
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover != null ? buckets[hover] : null;
  const busiest = buckets.reduce<(typeof buckets)[number] | null>(
    (best, b) => (b.km > (best?.km ?? 0) ? b : best),
    null,
  );
  const when = (ts: number) =>
    unit === 'week'
      ? `Week of ${shortDate(ts)}`
      : new Date(ts).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  // A week fits a weekday under every bar; longer ranges label about five.
  const weekdays = unit === 'day' && buckets.length <= 7;
  const every = weekdays ? 1 : Math.ceil(buckets.length / 5);
  const label = (ts: number) =>
    weekdays ? new Date(ts).toLocaleDateString([], { weekday: 'short' }) : shortDate(ts);
  // Gaps of their own would leave no room for bars past a month's worth.
  const gap = buckets.length > 31 ? 'gap-px' : 'gap-0.75';

  return (
    <section className="card overflow-hidden">
      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <div className="flex flex-col p-6 sm:p-8">
          <div className="eyebrow">Distance</div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="readout relative text-[4rem] font-light sm:text-[4.75rem]">
              {loading ? <Skeleton className="w-[2.5em]" /> : fmt(u.distance(s.distanceKm), 0)}
            </span>
            <span className="text-lg text-(--text-muted)">{u.distanceUnit}</span>
          </div>
          <p className="mt-2 text-sm text-(--text-secondary)">
            {loading ? (
              <Skeleton className="w-[16em]" />
            ) : s.drives === 0 ? (
              'No drives in this period.'
            ) : (
              <>
                {s.drives} drive{s.drives === 1 ? '' : 's'} · {fmtSeconds(s.drivingSeconds)} behind
                the wheel · {u.formatSpeed(s.distanceKm / (s.drivingSeconds / 3600))} average
              </>
            )}
          </p>

          <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-(--hairline) pt-6 sm:grid-cols-3">
            <Figure
              label="Efficiency"
              sub={s.energyKwh > 0 ? `${fmt(s.energyKwh, 1)} kWh used` : undefined}
            >
              {u.formatEfficiency(s.energyDistanceKm, s.energyKwh)}
            </Figure>
            <Figure
              label="Charged"
              sub={
                s.sessions > 0 ? `${s.sessions} session${s.sessions === 1 ? '' : 's'}` : undefined
              }
            >
              {s.sessions > 0 ? `${fmt(s.chargedKwh, 1)} kWh` : '—'}
            </Figure>
            <Figure
              label="Charging cost"
              sub={
                s.cost != null && s.distanceKm > 0
                  ? `${formatMoney(String(s.cost / (u.distance(s.distanceKm) ?? 1)), s.currency)} per ${u.distanceUnit}`
                  : undefined
              }
            >
              {s.cost != null
                ? `${s.costEstimated ? '≈ ' : ''}${formatMoney(String(s.cost), s.currency)}`
                : '—'}
            </Figure>
          </dl>
        </div>

        <div className="flex min-w-0 flex-col border-t border-(--hairline) p-6 sm:p-8 lg:border-t-0 lg:border-l">
          <div className="flex min-h-5 items-baseline justify-between gap-4 text-xs">
            <span className="eyebrow">By {unit}</span>
            <span className="text-(--text-muted) tabular-nums">
              {shown ? (
                <>
                  {when(shown.ts)} ·{' '}
                  <span className="text-(--text-primary)">{u.formatDistance(shown.km)}</span>
                </>
              ) : busiest && !loading ? (
                <>
                  Busiest {unit === 'week' ? `week of ${shortDate(busiest.ts)}` : when(busiest.ts)}{' '}
                  · <span className="text-(--text-secondary)">{u.formatDistance(busiest.km)}</span>
                </>
              ) : null}
            </span>
          </div>
          {loading ? (
            <SkeletonBlock height="12rem" className="mt-5" />
          ) : (
            <>
              <div
                className={`mt-5 flex min-h-48 flex-1 items-end ${gap}`}
                onPointerLeave={() => setHover(null)}
                role="img"
                aria-label={`Distance by ${unit}`}
              >
                {buckets.map((b, i) => (
                  <div
                    key={b.ts}
                    className="flex h-full min-w-0 flex-1 cursor-default items-end"
                    onPointerEnter={() => setHover(i)}
                  >
                    <div
                      className="w-full rounded-t-[3px] transition-[height,background-color] duration-300"
                      style={{
                        height: most > 0 && b.km > 0 ? `max(3px, ${(b.km / most) * 100}%)` : 2,
                        background:
                          b.km === 0
                            ? 'var(--surface-3)'
                            : hover === i
                              ? 'var(--accent)'
                              : hover == null
                                ? 'color-mix(in srgb, var(--accent) 78%, var(--surface-3))'
                                : 'color-mix(in srgb, var(--accent) 40%, var(--surface-3))',
                      }}
                    />
                  </div>
                ))}
              </div>
              <div className={`mt-2 flex text-[11px] text-(--text-muted) ${gap}`}>
                {buckets.map((b, i) => (
                  <div key={b.ts} className="relative h-4 min-w-0 flex-1">
                    {i % every === 0 && (
                      <span
                        className={`absolute whitespace-nowrap ${weekdays ? 'left-1/2 -translate-x-1/2' : 'left-0'}`}
                      >
                        {label(b.ts)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function Figure(props: { label: string; sub?: string; children: ReactNode }) {
  const loading = useLoading();
  return (
    <div className="min-w-0 last:max-sm:col-span-2">
      <dt className="eyebrow">{props.label}</dt>
      <dd className="mt-1.5 truncate text-[0.9375rem] font-medium tabular-nums">
        {loading ? <Skeleton className="w-[5em]" /> : props.children}
      </dd>
      <dd className="truncate text-xs text-(--text-muted)">
        {loading ? <Skeleton className="w-[6em]" /> : (props.sub ?? ' ')}
      </dd>
    </div>
  );
}
