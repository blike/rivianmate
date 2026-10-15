import { useLiveCharging, useUnits, useVehicleState } from '../../api/hooks';
import { InProgressTag } from '../../components/InProgressTag';
import { LoadingScope, Skeleton, useLoading } from '../../components/LoadingState';
import { SocTrack } from '../../components/SocTrack';
import { StatTiles } from '../../components/StatTiles';
import { liveCharge } from '../../lib/liveCharge';
import { fmt } from '../../lib/state';
import { liveTiles } from './liveTiles';

type Live = ReturnType<typeof useLiveCharging>['data'];

/** A charge in progress: how full, how fast, and when it's done. */
export function LiveCard(props: {
  live: Live;
  loading: boolean;
  state: ReturnType<typeof useVehicleState>['data'];
}) {
  const u = useUnits();
  const c = liveCharge(props.live, props.state);

  return (
    <LoadingScope loading={props.loading}>
      <section className="card overflow-hidden">
        <div className="p-5">
          <InProgressTag label="Charging now" />
          <ChargeLevel soc={c.soc} limit={c.limit} finish={c.finish} className="mt-2" />
          <SocTrack soc={c.soc} limit={c.limit} className="mt-3" />
        </div>
        <StatTiles tiles={liveTiles(c, u)} columns="sm:grid-cols-3" />
      </section>
    </LoadingScope>
  );
}

export function ChargeLevel(props: {
  soc: number | null;
  limit: number | null;
  finish: string | null;
  className?: string;
}) {
  const loading = useLoading();
  return (
    <div
      className={`flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 ${props.className ?? ''}`}
    >
      <div className="text-3xl font-semibold tabular-nums tracking-tight">
        {loading ? <Skeleton className="w-[3em]" /> : `${fmt(props.soc, 0)}%`}
        {props.limit != null && !loading && (
          <span className="ml-2 text-base font-normal text-(--text-muted)">
            of {fmt(props.limit, 0)}% limit
          </span>
        )}
      </div>
      {props.finish && !loading && (
        <div className="text-sm text-(--text-secondary)">
          Done around <span className="font-medium text-(--text-primary)">{props.finish}</span>
        </div>
      )}
    </div>
  );
}
