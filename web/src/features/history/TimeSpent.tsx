import { useEffect, useMemo, useRef, useState } from 'react';
import type { StateSpanDto } from '@server/api-types';
import { ContentFrame } from '../../components/LoadingState';
import { clock, dateTime } from '../../lib/format';
import { fmtSeconds } from '../../lib/state';
import { type StateSegment, stateRows, stateTotals } from './history';
import { STATE_ORDER, STATE_STYLE } from './states';

/** Day rows up to a month; a day's own is already the timeline. */
const BY_DAY_MAX_HOURS = 24 * 30;

/**
 * How the period's time divided between driving, charging, awake and
 * asleep: the shares, then each day laid out midnight to midnight.
 */
export function TimeSpent(props: {
  spans: StateSpanDto[] | undefined;
  loading: boolean;
  from: Date;
  to: Date;
  hours: number;
}) {
  const spans = useMemo(() => props.spans ?? [], [props.spans]);
  const totals = useMemo(() => stateTotals(spans), [spans]);
  const all = [...totals.values()].reduce((a, b) => a + b, 0);
  const byDay = props.hours > 24 && props.hours <= BY_DAY_MAX_HOURS;
  const rows = useMemo(() => {
    if (!byDay) return [];
    const all = stateRows(spans, props.from.getTime(), props.to.getTime(), true);
    // From the first day anything was recorded; days before then are just empty track.
    const first = all.findIndex((r) => r.segments.length > 0);
    return first < 0 ? [] : all.slice(first);
  }, [spans, props.from, props.to, byDay]);
  const [selected, setSelected] = useState<StateSegment | null>(null);
  const kinds = STATE_ORDER.filter((k) => totals.has(k));
  const rowHeight = rows.length > 10 ? 6 : 10;
  // A month of days scrolls in a fixed height, opening on the latest.
  const daysRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = daysRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows.length]);

  return (
    <section className="card flex h-full flex-col p-5 sm:p-6">
      <h2 className="eyebrow mb-5 text-(--text-secondary)">Time spent</h2>
      <ContentFrame
        height="12rem"
        loading={props.loading}
        empty={spans.length === 0}
        emptyText="No state recorded in this period."
      >
        <div className="flex h-3 gap-0.5 overflow-hidden rounded-full" aria-hidden>
          {kinds.map((k) => (
            <span
              key={k}
              style={{ flexGrow: totals.get(k)!, flexBasis: 0, background: STATE_STYLE[k].fill }}
            />
          ))}
        </div>
        <dl className="mt-4 divide-y divide-(--hairline)">
          {kinds.map((k) => (
            <div key={k} className="flex items-center gap-3 py-2 text-sm">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: STATE_STYLE[k].swatch }}
              />
              <dt className="flex-1 text-(--text-secondary)">{STATE_STYLE[k].label}</dt>
              <dd className="tabular-nums">{fmtSeconds(totals.get(k)! / 1000)}</dd>
              <dd className="w-10 text-right text-xs text-(--text-muted) tabular-nums">
                {Math.round((totals.get(k)! / all) * 100)}%
              </dd>
            </div>
          ))}
        </dl>

        {rows.length > 0 && (
          <div className="mt-6 border-t border-(--hairline) pt-5">
            <div className="mb-3 flex min-h-4 items-baseline justify-between gap-3 text-xs">
              <span className="eyebrow">Day by day</span>
              {selected && (
                <span className="truncate text-(--text-muted) tabular-nums">
                  {STATE_STYLE[selected.state].label} · {dateTime(selected.from)} –{' '}
                  {clock(selected.to)}
                </span>
              )}
            </div>
            <div
              ref={daysRef}
              className="max-h-56 space-y-1 overflow-y-auto overscroll-contain pr-1"
              onPointerLeave={() => setSelected(null)}
            >
              {rows.map((row) => (
                <div key={row.from} className="flex items-center gap-2.5">
                  <span className="flex w-12 shrink-0 justify-between text-[11px] text-(--text-muted) tabular-nums">
                    <span>{new Date(row.from).toLocaleDateString([], { weekday: 'short' })}</span>
                    <span>{new Date(row.from).getDate()}</span>
                  </span>
                  <div
                    className="relative grow overflow-hidden rounded-[2px] bg-(--surface-2)"
                    style={{ height: rowHeight }}
                  >
                    {row.segments.map((s) => (
                      <div
                        key={s.from}
                        className="absolute inset-y-0"
                        style={{
                          left: `${((s.from - row.from) / (row.to - row.from)) * 100}%`,
                          width: `${((s.to - s.from) / (row.to - row.from)) * 100}%`,
                          background: STATE_STYLE[s.state].fill,
                          opacity: selected && selected !== s ? 0.45 : 1,
                        }}
                        onPointerEnter={() => setSelected(s)}
                        onClick={() => setSelected(s)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="relative mt-1.5 mr-1 ml-14.5 h-4 text-[10.5px] text-(--text-muted)">
              {[0, 6, 12, 18].map((h) => (
                <span
                  key={h}
                  className="absolute -translate-x-1/2 whitespace-nowrap first:translate-x-0"
                  style={{ left: `${(h / 24) * 100}%` }}
                >
                  {new Date(2026, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' })}
                </span>
              ))}
            </div>
          </div>
        )}
      </ContentFrame>
    </section>
  );
}
