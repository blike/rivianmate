import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api } from '../../api/client';
import { ContentFrame } from '../../components/LoadingState';
import { Panel } from '../../components/Panel';
import { clock, dateTime } from '../../lib/format';
import { fmtSeconds } from '../../lib/state';
import { type StateSegment, type VehicleActivity, stateRows, stateTotals } from './history';
import { timeTicks } from './timeAxis';

/** Driving and charging match the metric chart's bands. */
const STATE: Record<VehicleActivity, { label: string; fill: string }> = {
  driving: { label: 'Driving', fill: 'var(--series-1)' },
  charging: { label: 'Charging', fill: 'var(--status-good)' },
  updating: {
    label: 'Updating',
    fill: 'repeating-linear-gradient(135deg, var(--series-4) 0 3px, color-mix(in srgb, var(--series-4) 45%, transparent) 3px 6px)',
  },
  awake: { label: 'Awake', fill: 'var(--series-4)' },
  asleep: { label: 'Asleep', fill: 'color-mix(in srgb, var(--series-3) 70%, transparent)' },
};
const ORDER: VehicleActivity[] = ['driving', 'charging', 'updating', 'awake', 'asleep'];

/** Day rows up to a month; longer ranges, and 24 hours, are one bar. */
const BY_DAY_MAX_HOURS = 24 * 30;

/** When the vehicle was driving, charging, awake or asleep over the period. */
export function StatePanel(props: {
  vehicleId: string;
  rangeLabel: string;
  hours: number;
  from: Date;
  to: Date;
}) {
  const { data: spans, isPending } = useQuery({
    queryKey: ['stateSpans', props.vehicleId, props.rangeLabel],
    queryFn: () => api.stateSpans(props.vehicleId, props.from, props.to),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
  const byDay = props.hours > 24 && props.hours <= BY_DAY_MAX_HOURS;
  const rows = useMemo(
    () => stateRows(spans ?? [], props.from.getTime(), props.to.getTime(), byDay),
    [spans, props.from, props.to, byDay],
  );
  const totals = useMemo(() => stateTotals(spans ?? []), [spans]);
  const [selected, setSelected] = useState<StateSegment | null>(null);

  // Day rows share a midnight-to-midnight axis; a single bar uses the window's.
  const axis = byDay
    ? [0, 6, 12, 18].map((h) => ({ at: h / 24, label: clock(new Date(2026, 0, 1, h).getTime()) }))
    : (() => {
        const span = props.to.getTime() - props.from.getTime();
        const { ticks, format } = timeTicks(props.from.getTime(), props.to.getTime(), 6);
        return ticks.map((t) => ({ at: (t - props.from.getTime()) / span, label: format(t) }));
      })();
  const rowHeight = rows.length > 7 ? 8 : 16;

  return (
    <Panel
      title="Vehicle state"
      action={
        selected ? (
          <span className="text-xs text-(--text-muted) tabular-nums">
            {STATE[selected.state].label} · {dateTime(selected.from)} – {clock(selected.to)} ·{' '}
            {fmtSeconds((selected.to - selected.from) / 1000)}
          </span>
        ) : undefined
      }
    >
      <ContentFrame
        height={rows.length * (rowHeight + 4) + 20}
        loading={isPending}
        empty={!spans?.length}
        emptyText="No state recorded in this period."
      >
        <div onPointerLeave={() => setSelected(null)}>
          <div className="space-y-1">
            {rows.map((row) => (
              <div key={row.from} className="flex items-center gap-2">
                {byDay && (
                  <span className="w-14 shrink-0 text-xs text-(--text-muted)">
                    {new Date(row.from).toLocaleDateString([], {
                      weekday: rows.length <= 7 ? 'short' : undefined,
                      month: rows.length <= 7 ? undefined : 'short',
                      day: rows.length <= 7 ? undefined : 'numeric',
                    })}
                  </span>
                )}
                <div
                  className="relative grow overflow-hidden rounded-sm bg-(--surface-2)"
                  style={{ height: rowHeight }}
                >
                  {row.segments.map((s) => (
                    <div
                      key={s.from}
                      className="absolute inset-y-0"
                      style={{
                        left: `${((s.from - row.from) / (row.to - row.from)) * 100}%`,
                        width: `${((s.to - s.from) / (row.to - row.from)) * 100}%`,
                        background: STATE[s.state].fill,
                        opacity: selected && selected !== s ? 0.55 : 1,
                      }}
                      onPointerEnter={() => setSelected(s)}
                      onClick={() => setSelected(s)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className={`relative mt-1 h-4 ${byDay ? 'ml-16' : ''}`}>
            {axis.map((t) => (
              <span
                key={t.at}
                className="absolute -translate-x-1/2 text-[11px] whitespace-nowrap text-(--text-muted) first:translate-x-0"
                style={{ left: `${t.at * 100}%` }}
              >
                {t.label}
              </span>
            ))}
          </div>
        </div>
      </ContentFrame>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-(--text-muted)">
        {ORDER.filter((k) => totals.has(k)).map((k) => (
          <li key={k} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: STATE[k].fill }} />
            {STATE[k].label}
            <span className="tabular-nums">{fmtSeconds(totals.get(k)! / 1000)}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
