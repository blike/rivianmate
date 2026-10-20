import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import { SkeletonBlock } from '../../components/LoadingState';
import { TimeTrace } from '../../components/TimeTrace';
import { fmtSeconds } from '../../lib/state';
import { stateRows, stateTotals } from '../history/history';
import { STATE_ORDER, STATE_STYLE } from '../history/states';

const DAY = 24 * 3600_000;

/**
 * The last 24 hours in one strip: the battery level traced over what the
 * vehicle was doing, and how long it spent at each.
 */
export function DayStrip(props: { vehicleId: string }) {
  // The window slides with the clock, a minute at a time.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const from = now - DAY;

  const { data: spans, isPending: spansPending } = useQuery({
    queryKey: ['stateSpans', props.vehicleId, '24h'],
    queryFn: () => api.stateSpans(props.vehicleId, new Date(from), new Date(now)),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
  const { data: battery, isPending: batteryPending } = useQuery({
    queryKey: ['history', props.vehicleId, 'battery', '24h'],
    queryFn: () => api.history(props.vehicleId, 'battery', new Date(from), new Date(now), 'raw'),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });

  const points = useMemo(
    () => (battery ?? []).map((p) => ({ ts: Date.parse(p.bucket), value: p.avg })),
    [battery],
  );
  const segments = useMemo(
    () => stateRows(spans ?? [], from, now, false)[0]?.segments ?? [],
    [spans, from, now],
  );
  const totals = useMemo(() => stateTotals(spans ?? []), [spans]);
  const loading = spansPending || batteryPending;

  return (
    <section className="card p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 className="eyebrow text-(--text-secondary)">Last 24 hours</h2>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-(--text-muted)">
          {STATE_ORDER.filter((k) => totals.has(k)).map((k) => (
            <li key={k} className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: STATE_STYLE[k].swatch }}
              />
              {STATE_STYLE[k].label}
              <span className="text-(--text-secondary) tabular-nums">
                {fmtSeconds(totals.get(k)! / 1000)}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {loading ? (
        <SkeletonBlock height={124} />
      ) : points.length === 0 && segments.length === 0 ? (
        <p className="grid h-[124px] place-items-center text-sm text-(--text-muted)">
          Nothing recorded in the last 24 hours.
        </p>
      ) : (
        <TimeTrace
          from={from}
          to={now}
          points={points}
          domain={[0, 100]}
          unit="%"
          label="Battery"
          segments={segments}
          height={84}
          axis
          maxTicks={8}
        />
      )}
    </section>
  );
}
