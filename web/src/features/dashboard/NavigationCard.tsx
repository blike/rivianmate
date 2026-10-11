import type { VehicleInsightsDto } from '@server/api-types';
import { useUnits } from '../../api/hooks';
import { fmt } from '../../lib/state';

/** Shown while the vehicle's navigation is active: where it's going and when it gets there. */
export function NavigationCard(props: {
  navigation: NonNullable<VehicleInsightsDto['navigation']>;
}) {
  const u = useUnits();
  const n = props.navigation;
  const eta = n.etaAt
    ? new Date(n.etaAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : null;
  const minutesLeft = n.remainingS != null ? Math.round(n.remainingS / 60) : null;
  const facts = [
    n.remainingKm != null && `${u.formatDistance(n.remainingKm, n.remainingKm < 10 ? 1 : 0)} to go`,
    minutesLeft != null &&
      (minutesLeft >= 60
        ? `${Math.floor(minutesLeft / 60)} h ${minutesLeft % 60} min`
        : `${minutesLeft} min`),
    eta && `arrives ${eta}`,
    n.arrivalSoc != null && `${fmt(n.arrivalSoc, 0)}% on arrival`,
  ].filter(Boolean);

  return (
    <section className="card flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-(--accent) px-4 py-3">
      <p className="min-w-0 truncate text-sm">
        <span className="text-(--text-secondary)">Navigating to</span>{' '}
        <span className="font-medium">
          {n.destination.name ?? `${fmt(n.destination.lat, 4)}, ${fmt(n.destination.lon, 4)}`}
        </span>
      </p>
      <p className="text-sm tabular-nums text-(--text-secondary)">{facts.join(' · ')}</p>
    </section>
  );
}
