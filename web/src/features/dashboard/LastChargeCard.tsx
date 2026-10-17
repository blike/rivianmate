import type { ChargingSessionDto } from '@server/api-types';
import { useUnits } from '../../api/hooks';
import { InProgressTag } from '../../components/InProgressTag';
import { PlaceIcon } from '../../components/PlaceIcon';
import { LoadingScope, Skeleton, useLoading } from '../../components/LoadingState';
import { chargerLabel, chargingSecondsNow, formatMoney, socRange } from '../../lib/charging';
import { clock } from '../../lib/format';
import { relativeTime } from '../../lib/freshness';
import type { LiveCharge } from '../../lib/liveCharge';
import { sessionEnergy } from '../../lib/sessionEnergy';
import { fmt, fmtDuration, fmtSeconds } from '../../lib/state';
import { type ScheduleStatus, dayLabel } from '../charging/schedules';
import { ActivityBar, ActivityCard, ActivityLine, ActivityStats } from './ActivityCard';
import { ChargeIcon } from './ActivityIcons';

/** The pack before this charge, and what it's added, on the activity bar. */
const BEFORE = 'color-mix(in srgb, var(--status-good) 35%, var(--surface-2))';
const ADDED = 'var(--status-good)';

/** The session plugged in now, or the last one. */
export function LastChargeCard(props: {
  session: ChargingSessionDto | undefined;
  now: number;
  /** Battery level and limit, and the charge under way, while plugged in. */
  charge?: LiveCharge | null;
  /** The charging schedule's next window; undefined until loaded. */
  schedule?: ScheduleStatus;
  /**
   * Whether vehicle state says it's plugged in, so the card is titled right
   * while the sessions load (it otherwise opens as "Last charge");
   * undefined while state hasn't loaded either.
   */
  plug?: 'charging' | 'plugged' | null;
  /** Whether vehicle state has loaded: plugged in, its battery level decides what shows. */
  stateLoaded?: boolean;
  /** The level the last finished charge reached, marked when no limit is reported. */
  lastChargedTo?: number | null;
}) {
  const loading = useLoading();
  const u = useUnits();
  const s = props.session;
  const pending = s == null ? (props.plug ?? null) : null;
  const open = (s != null && !s.endedAt) || pending != null;
  const c = open ? (props.charge ?? null) : null;
  const charging = s ? open && s.chargingSince != null : pending === 'charging';
  // Which line, bar and figures to show isn't settled until it's known
  // whether it's plugged in and, if it isn't charging, how full it is.
  const settled =
    (s != null || props.plug !== undefined) && (!open || charging || props.stateLoaded !== false);
  const seconds = s ? chargingSecondsNow(s, props.now) : null;
  const e = sessionEnergy(s, c?.energyKwh ?? null);
  const cost = s?.cost ?? s?.estimatedCost ?? null;
  const soc = c?.soc ?? s?.endSoc ?? null;
  const limit = c?.limit ?? null;
  // Without a reported limit (TeslaMate doesn't log one), the level the last
  // charge reached is marked instead; it doesn't make this charge complete.
  const lastCharge = limit == null ? (props.lastChargedTo ?? null) : null;
  const atLimit = soc != null && limit != null && soc >= limit - 0.5;
  const added =
    e != null
      ? { label: 'Energy added', value: `${e.estimated ? '≈ ' : ''}${fmt(e.kwh, 1)} kWh` }
      : {
          label: 'Battery added',
          value: s?.startSoc != null && soc != null ? `+${fmt(soc - s.startSoc, 1)}%` : '—',
        };

  if (!loading && !s) {
    return (
      <ActivityCard to="/charging" title="Last charge" when="" icon={<ChargeIcon />}>
        <p className="text-sm text-(--text-muted)">
          No charging sessions yet. They appear here after the next plug-in.
        </p>
      </ActivityCard>
    );
  }

  const start = s ? clock(s.chargingStartedAt ?? s.startedAt) : '';
  const costItem = {
    label: s?.cost == null && s?.estimatedCost != null ? 'Est. cost' : 'Cost',
    value: cost != null ? formatMoney(cost, s?.currency ?? null) : '—',
  };
  const pluggedFor = s ? fmtDuration(s.startedAt, null, props.now) : '—';
  const next = props.schedule;
  const waiting = atLimit
    ? s?.chargingEndedAt
      ? `Completed at ${clock(s.chargingEndedAt)}`
      : 'Completed'
    : next == null
      ? 'Not charging'
      : next.open
        ? `Window open until ${clock(next.endsAt.getTime())}`
        : `Starts ${dayLabel(next.startsAt, new Date(props.now))} at ${clock(next.startsAt.getTime())}`;

  return (
    <ActivityCard
      to="/charging"
      title={
        loading && !s && props.plug === undefined ? (
          <Skeleton className="w-[7em]" />
        ) : open ? (
          'Charging session'
        ) : (
          'Last charge'
        )
      }
      when={
        pending ? (
          <InProgressTag label={pending === 'charging' ? 'Charging' : 'Plugged in'} />
        ) : loading || !s ? (
          <Skeleton className="w-[4em]" />
        ) : open ? (
          <InProgressTag label={charging ? 'Charging' : 'Plugged in'} />
        ) : (
          // From when it started charging, as the list orders sessions.
          relativeTime(new Date(s.chargingStartedAt ?? s.startedAt), props.now)
        )
      }
      icon={<ChargeIcon />}
    >
      <LoadingScope loading={loading || !settled}>
        <ActivityLine
          note={
            s &&
            (open
              ? s.chargingStartedAt
                ? `Started ${clock(s.chargingStartedAt)}`
                : `Plugged in ${clock(s.startedAt)}`
              : `${start} – ${clock(s.chargingEndedAt ?? s.endedAt!)}`)
          }
        >
          {s && <PlaceIcon isHome={s.isHome} saved={s.location != null} />}
          {s ? chargerLabel(s) : ''}
        </ActivityLine>

        <ActivityBar
          label={soc != null ? `Battery at ${fmt(soc, 0)}%` : undefined}
          segments={
            soc == null
              ? []
              : [
                  { from: 0, to: Math.min(s?.startSoc ?? soc, soc), color: BEFORE },
                  { from: s?.startSoc ?? soc, to: soc, color: ADDED },
                ]
          }
          tick={open ? (limit ?? lastCharge) : null}
          left={
            open ? (
              soc != null ? (
                <>
                  {fmt(soc, 0)}%
                  {limit != null
                    ? ` of ${fmt(limit, 0)}% limit`
                    : lastCharge != null && ` · last charge ${fmt(lastCharge, 0)}%`}
                </>
              ) : (
                'Battery level unknown'
              )
            ) : s?.startSoc != null || s?.endSoc != null ? (
              socRange(s.startSoc, s.endSoc)
            ) : (
              'Battery level not recorded'
            )
          }
          right={
            charging
              ? c?.finish
                ? `Done around ${c.finish}`
                : undefined
              : open
                ? waiting
                : s?.startSoc != null && s.endSoc != null
                  ? `+${fmt(s.endSoc - s.startSoc, 1)}%`
                  : undefined
          }
        />

        <ActivityStats
          items={
            charging
              ? [
                  {
                    label: 'Current power',
                    value: c?.powerKw != null ? `${fmt(c.powerKw, 1)} kW` : '—',
                  },
                  added,
                  {
                    label: 'Time left',
                    value: c?.secondsLeft ? fmtSeconds(c.secondsLeft) : '—',
                  },
                ]
              : open
                ? [
                    ...(atLimit
                      ? // Done: what it added, how long that took, and what it cost.
                        [
                          added,
                          {
                            label: 'Time charging',
                            value: seconds != null ? fmtSeconds(seconds) : '—',
                          },
                          costItem,
                        ]
                      : // Waiting for its schedule: when it'll charge.
                        [
                          {
                            label: 'Starts',
                            value:
                              next == null
                                ? '—'
                                : next.open
                                  ? 'Now'
                                  : clock(next.startsAt.getTime()),
                          },
                          {
                            label: 'Window ends',
                            value: next ? clock(next.endsAt.getTime()) : '—',
                          },
                          { label: 'Plugged in', value: pluggedFor },
                        ]),
                  ]
                : [
                    added,
                    { label: 'Time charging', value: seconds != null ? fmtSeconds(seconds) : '—' },
                    s?.rangeAddedKm != null && cost == null
                      ? { label: 'Range added', value: u.formatDistance(s.rangeAddedKm) }
                      : costItem,
                  ]
          }
        />
      </LoadingScope>
    </ActivityCard>
  );
}
