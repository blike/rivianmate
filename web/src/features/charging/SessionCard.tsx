import type { ChargingSessionDto } from '../../api/client';
import { useUnits } from '../../api/hooks';
import { InProgressTag } from '../../components/InProgressTag';
import { PlaceIcon } from '../../components/PlaceIcon';
import { SocTrack } from '../../components/SocTrack';
import { Skeleton, useLoading } from '../../components/LoadingState';
import { type StatTile, StatTiles } from '../../components/StatTiles';
import {
  chargerLabel,
  chargingSecondsNow,
  formatMoney,
  sessionCost,
  socRange,
} from '../../lib/charging';
import { clock, longDay } from '../../lib/format';
import type { LiveCharge } from '../../lib/liveCharge';
import { averagePowerKw, sessionEnergy } from '../../lib/sessionEnergy';
import { fmt, fmtDuration, fmtSeconds } from '../../lib/state';
import { CostEditor } from './CostEditor';
import { energyTile, powerTile } from './liveTiles';
import { chargeStart } from './sessions';

/**
 * The chosen session: where and when, its battery as a bar, then its
 * figures. The session plugged in now keeps the same layout, live.
 */
export function SessionCard(props: {
  session: ChargingSessionDto | undefined;
  /** The charge under way, when this is its session. */
  live?: LiveCharge | null;
  /** The level the last finished charge reached, marked when no limit is reported. */
  lastChargedTo?: number | null;
  onSaveCost?: (cost: string | null) => void;
}) {
  const u = useUnits();
  const loading = useLoading();
  const s = props.session;
  const live = s && !s.endedAt ? (props.live ?? null) : null;
  const chargingSeconds = s ? chargingSecondsNow(s) : null;
  const cost = s ? sessionCost(s) : null;
  const e = sessionEnergy(s, live?.energyKwh ?? null);
  const energy = e?.kwh ?? null;
  const average = s?.avgPowerKw ?? averagePowerKw(energy, chargingSeconds);
  const energyFigure = energyTile(energy, live?.rangeAddedKm ?? s?.rangeAddedKm ?? null, u);

  const tiles: StatTile[] = [
    e?.estimated
      ? { ...energyFigure, value: `≈ ${energyFigure.value}`, sub: 'Estimated from battery gained' }
      : energyFigure,
    {
      label: 'Time charging',
      value: chargingSeconds != null ? fmtSeconds(chargingSeconds) : '—',
      sub: s ? `Plugged in ${fmtDuration(s.startedAt, s.endedAt)}` : undefined,
    },
    live?.powerKw != null
      ? powerTile(live, u)
      : s?.maxPowerKw != null
        ? {
            label: 'Power',
            value: `${fmt(s.maxPowerKw, 1)} kW peak`,
            sub: average != null ? `${fmt(average, 1)} kW average` : undefined,
          }
        : {
            label: 'Power',
            value: average != null ? `${e?.estimated ? '≈ ' : ''}${fmt(average, 1)} kW` : '—',
            sub: average != null ? 'Average while charging' : undefined,
          },
    {
      label: 'Cost',
      value:
        s && props.onSaveCost ? (
          <CostEditor key={s.id} session={s} onSave={props.onSaveCost} />
        ) : cost ? (
          `${cost.estimated ? '≈ ' : ''}${formatMoney(String(cost.amount), s?.currency ?? null)}`
        ) : (
          '—'
        ),
      sub:
        cost && energy
          ? `${formatMoney(String(cost.amount / energy), s?.currency ?? null)} per kWh${cost.estimated ? ' (home rate)' : ''}`
          : props.onSaveCost
            ? 'Click to add'
            : undefined,
    },
  ];

  return (
    <section className="card overflow-hidden">
      <div className="p-5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-(--text-muted)">
          {loading || !s ? (
            <Skeleton className="w-[14em]" />
          ) : (
            <>
              <TimeRange session={s} />
              {s.source === 'rivian' && <SourceBadge />}
              {s.source === 'teslamate' && (
                <SourceBadge label="TeslaMate" title="Read from TeslaMate" />
              )}
              {!s.endedAt && (
                <span className="ml-auto">
                  <InProgressTag label={s.chargingSince ? 'Charging' : 'Plugged in'} />
                </span>
              )}
            </>
          )}
        </div>
        <h2 className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-2 text-base lg:text-xl font-semibold tracking-tight">
          {loading || !s ? (
            <Skeleton className="w-[12em]" />
          ) : (
            <>
              <span className="min-w-0 truncate">
                <PlaceIcon isHome={s.isHome} saved={s.location != null} />
                {chargerLabel(s)}
              </span>
              {s.city && !s.isHome && !s.location && (
                <span className="text-base font-normal text-(--text-secondary)">{s.city}</span>
              )}
            </>
          )}
        </h2>
        <BatteryRow session={s} live={live} lastChargedTo={props.lastChargedTo ?? null} />
      </div>
      <StatTiles tiles={tiles} columns="grid-cols-2 lg:grid-cols-4" />
    </section>
  );
}

/** The battery over the session, with the charge limit while plugged in. */
function BatteryRow(props: {
  session: ChargingSessionDto | undefined;
  live: LiveCharge | null;
  lastChargedTo: number | null;
}) {
  const loading = useLoading();
  const s = props.session;
  const live = props.live;
  const end = live?.soc ?? s?.endSoc ?? null;
  const known = s != null && (s.startSoc != null || end != null);
  const atLimit = live?.soc != null && live.limit != null && live.soc >= live.limit - 0.5;
  // Without a reported limit (TeslaMate doesn't log one), the level the last
  // charge reached is marked instead; it doesn't make this charge complete.
  const lastCharge = live && live.limit == null ? props.lastChargedTo : null;
  const right = live
    ? live.finish
      ? `Done around ${live.finish}${live.secondsLeft ? ` · ${fmtSeconds(live.secondsLeft)} left` : ''}`
      : s?.chargingSince
        ? 'Charging'
        : atLimit
          ? s?.chargingEndedAt
            ? `Completed at ${clock(s.chargingEndedAt)}`
            : 'Completed'
          : 'Not charging'
    : s?.startSoc != null && end != null
      ? `+${fmt(end - s.startSoc, 1)}%`
      : '';
  return (
    <div className="mt-4">
      <SocTrack soc={end} limit={live?.limit ?? lastCharge ?? null} start={s?.startSoc} />
      <div className="mt-2 flex flex-wrap justify-between gap-x-3 gap-y-1 text-sm tabular-nums">
        {loading || !s ? (
          <Skeleton className="w-[10em]" />
        ) : (
          <>
            <span>
              {known ? socRange(s.startSoc, end) : 'Battery level not recorded'}
              {live?.limit != null ? (
                <span className="text-(--text-muted)"> of {fmt(live.limit, 0)}% limit</span>
              ) : (
                lastCharge != null && (
                  <span className="text-(--text-muted)"> · last charge {fmt(lastCharge, 0)}%</span>
                )
              )}
            </span>
            <span className="text-(--text-secondary)">{right}</span>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * When it charged, e.g. "Thu, Oct 8 · 7:03 – 10:12 AM"; a charge still
 * running ends "now". Falls back to the plug-in times when the vehicle's
 * charger status wasn't recorded (e.g. sessions imported from Rivian).
 */
function TimeRange(props: { session: ChargingSessionDto }) {
  const s = props.session;
  const from = chargeStart(s);
  const charging = !s.endedAt && s.chargingSince != null;
  const to = charging ? null : (s.chargingEndedAt ?? s.endedAt);
  return (
    <span
      title={
        s.chargingStartedAt
          ? `Plugged in ${clock(s.startedAt)}${s.endedAt ? ` – ${clock(s.endedAt)}` : ''}`
          : undefined
      }
    >
      {longDay(from)} · {clock(from)}
      {to ? ` – ${clock(to)}` : charging ? ' – now' : ''}
    </span>
  );
}

function SourceBadge(props: { label?: string; title?: string }) {
  return (
    <span
      className="rounded-full border border-(--border) px-1.5 text-[10px] uppercase tracking-wide text-(--text-muted)"
      title={props.title ?? "Imported from Rivian's charging history"}
    >
      {props.label ?? 'Rivian'}
    </span>
  );
}
