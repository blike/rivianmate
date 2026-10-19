import { useMemo, useState } from 'react';
import type { DriveDto } from '@server/api-types';
import { useUnits } from '../../api/hooks';
import { ContentFrame } from '../../components/LoadingState';
import { PlaceIcon } from '../../components/PlaceIcon';
import { commonRoutes, topDestinations } from './patterns';
import { Segmented } from './Segmented';

/** Where the vehicle goes most, and the trips it makes again and again. */
export function PlacesPanel(props: {
  drives: DriveDto[] | undefined;
  loading: boolean;
  from: Date;
  to: Date;
}) {
  const u = useUnits();
  const [view, setView] = useState(0);
  const places = useMemo(
    () => topDestinations(props.drives ?? [], props.from.getTime(), props.to.getTime()),
    [props.drives, props.from, props.to],
  );
  const routes = useMemo(
    () => commonRoutes(props.drives ?? [], props.from.getTime(), props.to.getTime()),
    [props.drives, props.from, props.to],
  );
  const most = places[0]?.visits ?? 0;

  return (
    <section className="card flex h-full flex-col p-5 sm:p-6">
      <div className="mb-5 flex items-center justify-between gap-4">
        <h2 className="eyebrow text-(--text-secondary)">Places</h2>
        <Segmented label="Show" items={['Destinations', 'Trips']} value={view} onChange={setView} />
      </div>
      <ContentFrame
        height="13rem"
        loading={props.loading}
        empty={view === 0 ? places.length === 0 : routes.length === 0}
        emptyText={
          view === 0
            ? 'No finished drives in this period.'
            : 'No trip taken more than once in this period.'
        }
      >
        {view === 0 ? (
          <ol className="space-y-3.5">
            {places.map((p) => (
              <li key={p.label}>
                <div className="flex items-baseline gap-3 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    <PlaceIcon isHome={p.isHome} saved={p.saved} />
                    {p.label}
                  </span>
                  <span className="shrink-0 text-(--text-muted) tabular-nums">
                    {p.visits} visit{p.visits === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-(--surface-2)">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(p.visits / most) * 100}%`,
                      background: p.isHome
                        ? 'var(--accent)'
                        : 'color-mix(in srgb, var(--accent) 55%, var(--surface-3))',
                    }}
                  />
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <ol className="divide-y divide-(--hairline)">
            {routes.map((r) => (
              <li key={`${r.from}-${r.to}`} className="py-3 first:pt-0">
                <div className="flex min-w-0 items-baseline gap-2 text-sm">
                  <span className="truncate">{r.from}</span>
                  <span className="shrink-0 text-(--accent)" aria-label="and">
                    ⇄
                  </span>
                  <span className="truncate">{r.to}</span>
                </div>
                <div className="mt-1 flex gap-4 text-xs text-(--text-muted) tabular-nums">
                  <span>
                    <span className="text-(--text-secondary)">{r.trips}</span> trips
                  </span>
                  <span>{u.formatDistance(r.avgKm, 1)} each</span>
                  {r.energyKwh > 0 && <span>{u.formatEfficiency(r.energyKm, r.energyKwh)}</span>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </ContentFrame>
    </section>
  );
}
