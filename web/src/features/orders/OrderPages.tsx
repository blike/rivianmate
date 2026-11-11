import { Link } from 'react-router-dom';
import { useOrders } from '../../api/hooks';
import { OrderJourney } from './OrderJourney';

/**
 * Home while the account has no vehicle yet: each order on its way, or,
 * without one, what that means. Often the first page a new owner sees.
 */
export function AwaitingDeliveryPage(props: {
  vehiclesFailed?: boolean;
  /** Without a Rivian account (TeslaMate alone), there are no orders to ask about. */
  rivianConnected: boolean;
}) {
  const { data, isPending, isError } = useOrders(props.rivianConnected);
  // Not in the account yet, so not logged: even one Rivian already calls delivered.
  const waiting = data?.journeys.filter((j) => !j.delivered) ?? [];

  if (props.vehiclesFailed) {
    return (
      <EmptyState
        title="Couldn’t load your vehicles"
        body="RivianMate couldn’t reach its own server just now. Check your connections, then try again."
      />
    );
  }
  if (!props.rivianConnected) {
    return (
      <EmptyState
        title="No vehicle connected yet"
        body="Connect your Rivian account in Settings, and RivianMate starts logging, or follows your order until it's delivered."
      />
    );
  }
  if (waiting.length > 0) {
    return (
      <div className="journey-backdrop -mx-4 overflow-x-clip px-4 sm:-mx-6 sm:px-6 lg:-mx-10 lg:-mt-8 lg:px-10 lg:pt-8 xl:-mx-12 xl:px-12">
        {waiting.map((j, i) => (
          <div key={j.orderId} className={i > 0 ? 'mt-16 border-t border-(--hairline) pt-10' : ''}>
            <OrderJourney
              journey={j}
              checkedAt={data?.checkedAt}
              refreshMinutes={data?.refreshMinutes}
            />
          </div>
        ))}
      </div>
    );
  }
  if (isPending || (data && data.checkedAt == null && !isError)) {
    return <Looking />;
  }
  return (
    <EmptyState
      title="No Rivian here yet"
      body="RivianMate is connected, but Rivian lists no vehicle or open order on this account. A new order can take a little while to show up; this page fills in on its own when it does."
    />
  );
}

export function DeliveryPage(props: { vehicleId: string; vehicleName?: string | null }) {
  const { data, isPending } = useOrders();
  const journey = data?.journeys.find((j) => j.vehicleId === props.vehicleId);
  if (journey) {
    return (
      <div className="journey-backdrop -mx-4 overflow-x-clip px-4 sm:-mx-6 sm:px-6 lg:-mx-10 lg:-mt-8 lg:px-10 lg:pt-8 xl:-mx-12 xl:px-12">
        <OrderJourney
          journey={journey}
          checkedAt={data?.checkedAt}
          vehicleName={props.vehicleName}
        />
      </div>
    );
  }
  if (isPending || data?.checkedAt == null) return <Looking />;
  return (
    <EmptyState
      title="No order for this vehicle"
      body="Rivian has no order for it on this account, as with a vehicle bought from someone else or shared with you."
    />
  );
}

function Looking() {
  return (
    <div className="delayed-fade-in grid min-h-[60vh] place-items-center text-center">
      <div>
        <div className="mx-auto mb-5 h-px w-24 overflow-hidden bg-(--hairline)">
          <div className="h-full w-1/3 animate-[ota-indeterminate_1.4s_ease-in-out_infinite] bg-(--accent)" />
        </div>
        <p className="text-sm text-(--text-secondary)">Asking Rivian about your order…</p>
      </div>
    </div>
  );
}

function EmptyState(props: { title: string; body: string }) {
  return (
    <div className="journey-backdrop -mx-4 overflow-x-clip grid min-h-[70vh] place-items-center px-4 sm:-mx-6 sm:px-6 lg:-mx-10 lg:-mt-8 lg:px-10 xl:-mx-12 xl:px-12">
      <div className="journey-rise max-w-120 text-center">
        <KeyMark />
        <h1 className="mt-6 text-[1.75rem] leading-tight font-semibold tracking-[-0.02em]">
          {props.title}
        </h1>
        <p className="mt-3 leading-relaxed text-pretty text-(--text-secondary)">{props.body}</p>
        <Link to="/settings" className="btn-secondary mt-7 inline-flex">
          Check your connections
        </Link>
      </div>
    </div>
  );
}

function KeyMark() {
  return (
    <span className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-[color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] text-(--accent)">
      <svg
        viewBox="0 0 24 24"
        width="24"
        height="24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx="8" cy="15" r="3.5" />
        <path d="m10.5 12.5 8.5-8.5M16 7l2 2M13.5 9.5 15 11" />
      </svg>
    </span>
  );
}
