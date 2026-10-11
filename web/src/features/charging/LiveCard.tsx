import { useLiveCharging, useUnits, useVehicleState } from '../../api/hooks';
import { Dot } from '../../components/Dot';
import { LoadingScope, Skeleton, useLoading } from '../../components/LoadingState';
import { type StatTile, StatTiles } from '../../components/StatTiles';
import { clock } from '../../lib/format';
import { fmt, fmtSeconds, nv } from '../../lib/state';

type Live = ReturnType<typeof useLiveCharging>['data'];

/** A charge in progress: how full, how fast, and when it's done. */
export function LiveCard(props: {
  live: Live;
  loading: boolean;
  state: ReturnType<typeof useVehicleState>['data'];
}) {
  const u = useUnits();
  const live = props.live;
  const soc = num(live?.soc?.value) ?? nv(props.state, 'batteryLevel');
  const limit = num(live?.socLimit?.value) ?? nv(props.state, 'batteryLimit');
  const secondsLeft = num(live?.timeRemaining?.value);
  // Counted from when the vehicle reported the time left.
  const reportedAt = Date.parse(live?.timeRemaining?.updatedAt ?? '');
  const finish =
    secondsLeft != null && secondsLeft > 0 && Number.isFinite(reportedAt)
      ? clock(reportedAt + secondsLeft * 1000)
      : null;
  const rate = num(live?.kilometersChargedPerHour?.value);

  const tiles: StatTile[] = [
    {
      label: 'Power',
      value: `${fmt(num(live?.power?.value), 1)} kW`,
      sub: rate != null ? u.formatChargeRate(rate) : undefined,
    },
    {
      label: 'Energy added',
      value: `${fmt(num(live?.totalChargedEnergy?.value), 1)} kWh`,
      sub: live?.rangeAddedThisSession
        ? `${u.formatDistance(num(live.rangeAddedThisSession.value))} of range`
        : undefined,
    },
    {
      label: 'Time remaining',
      value: secondsLeft != null ? fmtSeconds(secondsLeft) : '—',
      sub: finish ? `Done around ${finish}` : undefined,
    },
  ];

  return (
    <LoadingScope loading={props.loading}>
      <section className="card overflow-hidden border-[color-mix(in_srgb,var(--status-good)_45%,var(--border))]">
        <div className="p-5">
          <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-(--status-good)">
            <Dot color="var(--status-good)" pulse />
            Charging now
          </div>
          <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <div className="text-3xl font-semibold tabular-nums tracking-tight">
              {props.loading ? <Skeleton className="w-[3em]" /> : `${fmt(soc, 0)}%`}
              {limit != null && !props.loading && (
                <span className="ml-2 text-base font-normal text-(--text-muted)">
                  of {fmt(limit, 0)}% limit
                </span>
              )}
            </div>
          </div>
          <SocTrack soc={soc} limit={limit} />
        </div>
        <StatTiles tiles={tiles} columns="sm:grid-cols-3" />
      </section>
    </LoadingScope>
  );
}

/** Battery level toward the charge limit, with the limit marked. */
function SocTrack(props: { soc: number | null; limit: number | null }) {
  const loading = useLoading();
  const soc = Math.max(0, Math.min(100, props.soc ?? 0));
  return (
    <div className="relative mt-3 h-2 rounded-full bg-(--surface-2)">
      {!loading && (
        <div
          className="h-full rounded-full bg-(--status-good) transition-[width] duration-700"
          style={{ width: `${soc}%` }}
        />
      )}
      {props.limit != null && (
        <span
          aria-hidden
          className="absolute -top-1 bottom-1 w-0.5 rounded-full bg-(--text-secondary)"
          style={{ left: `calc(${Math.min(100, props.limit)}% - 1px)` }}
        />
      )}
    </div>
  );
}

function num(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
