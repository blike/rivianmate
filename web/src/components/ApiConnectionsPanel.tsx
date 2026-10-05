import type { RivianDiagnosticsResponse, VehicleDto } from "../api/client.js";
import { LoadingScope, Skeleton } from "./loading.js";
import { Panel, Row } from "./panels.js";

const feedNames = {
  vehicleState: "Vehicle state", parallax: "Parallax", parallaxDynamics: "Parallax dynamics",
  chargingSession: "Charging", departureSchedules: "Departure schedules",
};
const pollingLabels = {
  stopped: "Stopped", standby: "Standby · stream connected",
  waiting: "Waiting for stream recovery", fallback: "Fallback polling active",
};

function receivedAt(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "Not yet recorded";
}

function FeedStatus({ status }: { status: "receiving" | "waiting" | "unsupported" | "errored" }) {
  const colors = { receiving: "var(--series-1)", waiting: "var(--text-secondary)", unsupported: "var(--text-muted)", errored: "var(--status-critical)" };
  return <span className="rounded-full border px-2 py-0.5 text-xs font-medium capitalize" style={{ color: colors[status], borderColor: "currentColor" }}>{status}</span>;
}

export function ApiConnectionsPanel({ diagnostics, loading, error, vehicles, mockMode }: {
  diagnostics: RivianDiagnosticsResponse | undefined;
  loading: boolean;
  error: boolean;
  vehicles: VehicleDto[];
  mockMode: boolean;
}) {
  const stream = diagnostics?.monitor.subscriptions;
  const cooldown = diagnostics?.traffic.cooldownUntil;
  const coolingDown = cooldown != null;
  return <>
    <div>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">Updates every 10 seconds. Times are local to your browser.</p>
      {mockMode && <p className="mt-2 text-sm text-[var(--text-secondary)]">Demo mode uses simulated vehicle data.</p>}
      {error && <p role="alert" className="mt-2 text-sm text-[var(--status-critical)]">Could not refresh API status. {diagnostics ? "The values below may be out of date." : "Retrying automatically."}</p>}
    </div>
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-[var(--border)] px-4 py-3 text-sm">
      <span>Connection: <span className="font-medium capitalize">{loading ? "Loading…" : !diagnostics ? "Unavailable" : mockMode ? "Simulated" : stream?.state ?? "Stopped"}</span></span>
      {diagnostics?.monitor.fallbackPolling && <span className="text-[var(--text-secondary)]">Fallback polling active</span>}
      {coolingDown && <span className="text-[var(--status-critical)]">Rate limited · paused until {receivedAt(cooldown)}</span>}
    </div>
    <Panel title="Feeds">
      {loading ? <div className="space-y-4"><Skeleton className="w-full" /><Skeleton className="w-full" /><Skeleton className="w-full" /></div> : !stream?.feeds.length ? (
        <p className="text-sm text-[var(--text-secondary)]">{!diagnostics ? "Feed status is unavailable." : mockMode ? "Live subscription diagnostics are unavailable in demo mode." : diagnostics.monitor.running ? "Waiting for subscriptions to start." : "Monitoring is stopped. Connect your Rivian account to receive feeds."}</p>
      ) : <div className="space-y-5">
        {(["Legacy", "Parallax"] as const).map(group => {
          const feeds = stream.feeds.filter(feed => group === "Legacy" ? feed.domain == null : feed.domain != null);
          if (!feeds.length) return null;
          return <section key={group} aria-label={`${group} feeds`}>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">{group}</h4>
            <ul className="divide-y divide-[var(--border)]">
              {feeds.map(feed => <li key={feed.id} className="py-3 first:pt-0">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium capitalize">{feed.domain ?? feedNames[feed.kind]}</span><FeedStatus status={feed.status} />
                </div>
                {vehicles.length > 1 && <p className="mt-1 text-xs text-[var(--text-secondary)]">{vehicles.find(v => v.id === feed.vehicleId)?.name ?? vehicles.find(v => v.id === feed.vehicleId)?.model ?? "Vehicle"}</p>}
                <p className="mt-1 text-xs text-[var(--text-muted)]">Last data: {receivedAt(feed.lastMessageAt)}</p>
                {feed.topics.length > 0 && <details className="mt-2 text-xs text-[var(--text-secondary)]">
                  <summary className="cursor-pointer">{feed.topics.length} subscribed topics</summary>
                  <ul className="mt-2 space-y-1 break-all font-mono">{feed.topics.map(topic => <li key={topic}>{topic}</li>)}</ul>
                </details>}
              </li>)}
            </ul>
          </section>;
        })}
      </div>}
      <p className="mt-3 text-xs text-[var(--text-secondary)]">Receiving means data arrived for that feed or domain within 5 minutes on the current connection. Waiting can be normal when the vehicle is asleep or no charging session is active. Unsupported means Rivian rejected the subscription.</p>
    </Panel>
    <details className="card p-4">
      <summary className="cursor-pointer text-sm font-medium">Connection details</summary>
      <div className="mt-4">
    <section aria-label="Legacy API">
      <h3 className="mb-3 text-sm font-medium">Legacy API</h3>
      <LoadingScope loading={loading}>
        <dl className="space-y-3 text-sm">
          <Row label="Last successful request" value={diagnostics ? receivedAt(diagnostics.traffic.lastSuccessfulRequestAt) : "—"} />
          <Row label="Vehicle-state polling" value={diagnostics ? coolingDown && diagnostics.monitor.running ? "Paused by rate-limit cooldown" : pollingLabels[diagnostics.monitor.pollingStatus] : "—"} />
          <Row label="Rate-limit cooldown" value={!diagnostics ? "—" : coolingDown ? `Paused until ${receivedAt(cooldown)}` : "None"} />
        </dl>
      </LoadingScope>
      <p className="mt-3 text-xs text-[var(--text-secondary)]">Vehicle state normally arrives by subscription. Fallback polls run every 5 minutes while awake or 30 minutes while asleep, after stream recovery has been given time.</p>
    </section>
    <section aria-label="Subscriptions" className="mt-5">
      <h3 className="mb-3 text-sm font-medium">Subscriptions</h3>
      <LoadingScope loading={loading}>
        <dl className="space-y-3 text-sm">
          <Row label="WebSocket" value={!diagnostics ? "—" : mockMode ? "Simulated" : stream ? <span className="capitalize">{stream.state}</span> : diagnostics.monitor.running ? "Starting" : "Stopped"} />
          <Row label="Reconnect attempts (24h)" value={diagnostics ? diagnostics.traffic.last24h.wsReconnects : "—"} />
          <Row label="Last message received" value={diagnostics ? receivedAt(stream?.lastMessageAt) : "—"} />
        </dl>
      </LoadingScope>
      <p className="mt-3 text-xs text-[var(--text-secondary)]">Socket messages include keepalives. Feed activity below measures data delivery.</p>
    </section>
      </div>
    </details>
    <details className="card p-4">
      <summary className="cursor-pointer text-sm font-medium">API usage · last 24 hours</summary>
      <div className="mt-4">
      <p className="mb-3 text-xs text-[var(--text-secondary)]">Request volume and rate limits help diagnose excessive traffic. Counters reset when the server restarts.</p>
        <LoadingScope loading={loading}>
          <dl className="space-y-1 text-sm">
            <Row
              label="Requests"
              value={diagnostics ? String(diagnostics.traffic.last24h.httpRequests) : "—"}
            />
            <Row
              label="Stream connects / reconnects"
              value={
                diagnostics
                  ? `${diagnostics.traffic.last24h.wsConnects} / ${diagnostics.traffic.last24h.wsReconnects}`
                  : "—"
              }
            />
            <Row
              label="Session refreshes"
              value={diagnostics ? String(diagnostics.traffic.last24h.sessionRefreshes) : "—"}
            />
            <Row
              label="Rate limited"
              value={diagnostics ? String(diagnostics.traffic.last24h.rateLimited) : "—"}
            />
            {diagnostics && diagnostics.monitor.parallaxDroppedFields.length > 0 && (
              <Row
                label="Fields Rivian rejected"
                value={diagnostics.monitor.parallaxDroppedFields.join(", ")}
              />
            )}

          </dl>
        </LoadingScope>
        {loading ? (
          <p className="mt-3 text-xs">
            <Skeleton className="w-[24em] max-w-full" />
          </p>
        ) : (
          diagnostics &&
          Object.keys(diagnostics.traffic.requestsByOperation24h).length > 0 && (
            <p className="mt-3 text-xs text-[var(--text-secondary)]">
              {Object.entries(diagnostics.traffic.requestsByOperation24h)
                .sort((a, b) => b[1] - a[1])
                .map(([op, n]) => `${op} ${n}`)
                .join(" · ")}
            </p>
          )
        )}
      </div>
    </details>

  </>;
}
