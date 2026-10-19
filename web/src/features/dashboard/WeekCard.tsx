import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { ChargingSessionDto, DriveDto } from '@server/api-types';
import { useUnits } from '../../api/hooks';
import { Skeleton, useLoading } from '../../components/LoadingState';
import { fmt } from '../../lib/state';
import { distanceByPeriod, periodSummary, rangeWindow } from '../history/history';

/** The last seven days: how far, on which days, and what it took. */
export function WeekCard(props: {
  drives: DriveDto[] | undefined;
  sessions: ChargingSessionDto[] | undefined;
  now: number;
}) {
  const u = useUnits();
  const loading = useLoading();
  const { from, to } = useMemo(() => rangeWindow(24 * 7, new Date(props.now)), [props.now]);
  const summary = useMemo(
    () => periodSummary(props.drives ?? [], props.sessions ?? [], from.getTime(), to.getTime()),
    [props.drives, props.sessions, from, to],
  );
  const days = useMemo(
    () => distanceByPeriod(props.drives ?? [], from.getTime(), to.getTime(), 'day'),
    [props.drives, from, to],
  );
  const most = Math.max(...days.map((d) => d.km), 0);

  return (
    <Link
      to="/history"
      className="card group flex h-full flex-col gap-5 p-5 transition-colors hover:border-[color-mix(in_srgb,var(--accent)_35%,var(--hairline))]"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="eyebrow text-(--text-secondary)">This week</span>
        <span className="text-xs text-(--text-muted)">
          {from.toLocaleDateString([], { month: 'short', day: 'numeric' })} – today
        </span>
      </div>

      <div className="flex items-end justify-between gap-4">
        <div className="flex items-baseline gap-1.5">
          <span className="readout text-[2.75rem] font-[350]">
            {loading ? <Skeleton className="w-[2em]" /> : fmt(u.distance(summary.distanceKm), 0)}
          </span>
          <span className="text-sm text-(--text-muted)">{u.distanceUnit} driven</span>
        </div>
        {/* One bar a day, today's brightest. */}
        <div className="flex h-14 items-end gap-1.5" aria-hidden>
          {days.map((d, i) => {
            const today = i === days.length - 1;
            return (
              <div key={d.ts} className="flex w-4 flex-col items-center gap-1">
                <div className="flex h-10 w-full items-end">
                  <div
                    className="w-full rounded-[3px] transition-[height] duration-500"
                    style={{
                      height: loading || most === 0 ? 3 : `max(3px, ${(d.km / most) * 100}%)`,
                      background:
                        d.km > 0
                          ? today
                            ? 'var(--accent)'
                            : 'color-mix(in srgb, var(--accent) 50%, var(--surface-3))'
                          : 'var(--surface-3)',
                    }}
                  />
                </div>
                <span
                  className={`text-[10px] leading-3 ${today ? 'text-(--text-primary)' : 'text-(--text-muted)'}`}
                >
                  {new Date(d.ts).toLocaleDateString([], { weekday: 'narrow' })}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <dl className="mt-auto grid grid-cols-3 gap-3 border-t border-(--hairline) pt-4">
        <Stat label="Drives" value={fmt(summary.drives, 0)} />
        <Stat
          label="Efficiency"
          value={u.formatEfficiency(summary.energyDistanceKm, summary.energyKwh)}
        />
        <Stat
          label="Charged"
          value={summary.sessions > 0 ? `${fmt(summary.chargedKwh, 0)} kWh` : '—'}
        />
      </dl>
    </Link>
  );
}

function Stat(props: { label: string; value: string }) {
  const loading = useLoading();
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-(--text-muted)">{props.label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium tabular-nums">
        {loading ? <Skeleton className="w-[4em]" /> : props.value}
      </dd>
    </div>
  );
}
