import type { ChargingSessionDto } from '../../api/client';
import { useUnits } from '../../api/hooks';
import { HomeIcon } from '../../components/HomeIcon';
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
import { fmt, fmtDuration, fmtSeconds } from '../../lib/state';
import { CostEditor } from './CostEditor';
import { chargeStart } from './sessions';

/** The chosen session: where and when up front, then its figures. */
export function SessionCard(props: {
  session: ChargingSessionDto | undefined;
  onSaveCost?: (cost: string | null) => void;
}) {
  const u = useUnits();
  const loading = useLoading();
  const s = props.session;
  const chargingSeconds = s ? chargingSecondsNow(s) : null;
  const cost = s ? sessionCost(s) : null;
  const energy = s?.energyKwh ?? null;

  const tiles: StatTile[] = [
    {
      label: 'Energy added',
      value: energy != null ? `${fmt(energy, 1)} kWh` : '—',
      sub: s?.rangeAddedKm != null ? `${u.formatDistance(s.rangeAddedKm)} of range` : undefined,
    },
    {
      label: 'Battery',
      value: s ? socRange(s.startSoc, s.endSoc) : '—',
      sub:
        s?.startSoc != null && s.endSoc != null ? `+${fmt(s.endSoc - s.startSoc, 0)}%` : undefined,
    },
    {
      label: 'Time charging',
      value: chargingSeconds != null ? fmtSeconds(chargingSeconds) : '—',
      sub: s ? `Plugged in ${fmtDuration(s.startedAt, s.endedAt)}` : undefined,
    },
    {
      label: 'Power',
      value: s?.maxPowerKw != null ? `${fmt(s.maxPowerKw, 1)} kW peak` : '—',
      sub: s?.avgPowerKw != null ? `${fmt(s.avgPowerKw, 1)} kW average` : undefined,
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
              {!s.endedAt && (
                <span
                  className={`font-medium uppercase tracking-wide ${s.chargingSince ? 'text-(--status-good)' : 'text-(--text-secondary)'}`}
                >
                  {s.chargingSince ? 'Charging' : 'Plugged in'}
                </span>
              )}
              <TimeRange session={s} />
              {s.source === 'rivian' && <SourceBadge />}
              {s.source === 'teslamate' && (
                <SourceBadge label="TeslaMate" title="Read from TeslaMate" />
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
                {s.isHome && <HomeIcon />}
                {chargerLabel(s)}
              </span>
              {s.city && !s.isHome && (
                <span className="text-base font-normal text-(--text-secondary)">{s.city}</span>
              )}
            </>
          )}
        </h2>
      </div>
      <StatTiles tiles={tiles} columns="sm:grid-cols-3 lg:grid-cols-5" />
    </section>
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
