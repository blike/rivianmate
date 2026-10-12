import type { ChargingSessionDto } from '@server/api-types';
import { useUnits } from '../../api/hooks';
import { Skeleton, useLoading } from '../../components/LoadingState';
import { chargerLabel, chargingSecondsNow, formatMoney } from '../../lib/charging';
import { relativeTime } from '../../lib/freshness';
import { fmt, fmtSeconds } from '../../lib/state';
import { ActivityCard, ActivityStats } from './ActivityCard';
import { ChargeIcon } from './ActivityIcons';

export function LastChargeCard(props: { session: ChargingSessionDto | undefined; now: number }) {
  const loading = useLoading();
  const u = useUnits();
  const s = props.session;
  const live = s != null && !s.endedAt;
  const seconds = s ? chargingSecondsNow(s, props.now) : null;
  const cost = s?.cost ?? s?.estimatedCost ?? null;

  if (!loading && !s) {
    return (
      <ActivityCard to="/charging" title="Last charge" when="" icon={<ChargeIcon />}>
        <p className="text-sm text-(--text-muted)">
          No charging sessions yet. They appear here after the next plug-in.
        </p>
      </ActivityCard>
    );
  }

  return (
    <ActivityCard
      to="/charging"
      title={live ? 'Charging session' : 'Last charge'}
      when={
        loading || !s ? (
          <Skeleton className="w-[4em]" />
        ) : live ? (
          'In progress'
        ) : (
          relativeTime(new Date(s.endedAt!), props.now)
        )
      }
      icon={<ChargeIcon />}
    >
      <div className="flex min-w-0 items-center gap-3">
        {loading || !s ? (
          <Skeleton className="w-[14em]" />
        ) : s.startSoc == null && s.endSoc == null ? (
          <span className="truncate text-base font-medium">{chargerLabel(s)}</span>
        ) : (
          <>
            <span className="shrink-0 text-base font-medium tabular-nums">
              {s.startSoc != null ? `${fmt(s.startSoc, 1)}%` : '?'}
              <span className="mx-1.5 text-(--accent)">→</span>
              {s.endSoc != null ? `${fmt(s.endSoc, 1)}%` : '?'}
            </span>
            <SocSpan start={s.startSoc} end={s.endSoc} />
            <span className="shrink-0 truncate text-sm text-(--text-secondary)">
              {chargerLabel(s)}
            </span>
          </>
        )}
      </div>
      <ActivityStats
        items={[
          { label: 'Energy', value: s?.energyKwh != null ? `${fmt(s.energyKwh, 1)} kWh` : '—' },
          { label: 'Time charging', value: seconds != null ? fmtSeconds(seconds) : '—' },
          s?.rangeAddedKm != null && cost == null
            ? { label: 'Range added', value: u.formatDistance(s.rangeAddedKm) }
            : {
                label: s?.cost == null && s?.estimatedCost != null ? 'Est. cost' : 'Cost',
                value: cost != null ? formatMoney(cost, s?.currency ?? null) : '—',
              },
        ]}
      />
    </ActivityCard>
  );
}

/** A slim track showing the part of the pack a charge filled. */
function SocSpan(props: { start: number | null; end: number | null }) {
  if (props.start == null || props.end == null || props.end <= props.start) {
    return <span className="flex-1" />;
  }
  return (
    <span
      className="relative h-1.5 min-w-12 flex-1 overflow-hidden rounded-full bg-(--surface-2)"
      aria-hidden
    >
      <span
        className="absolute inset-y-0 rounded-full bg-(--status-good)"
        style={{ left: `${props.start}%`, width: `${props.end - props.start}%` }}
      />
    </span>
  );
}
