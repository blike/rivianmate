import { useEffect, useState, type ReactNode } from "react";
import type { RivianDiagnosticsResponse, VehicleDto } from "../api/client.js";
import { relativeTime } from "../lib/freshness.js";
import { LoadingScope, Skeleton } from "./loading.js";
import { Row } from "./panels.js";
import { HeroTiles, SettingsGroup, SettingsHero } from "./settings.js";

const feedNames = {
  vehicleState: "Vehicle state", parallax: "Parallax", parallaxDynamics: "Parallax dynamics",
  chargingSession: "Charging", departureSchedules: "Departure schedules",
};
const pollingLabels = {
  stopped: "Stopped", standby: "Standby · stream connected",
  waiting: "Waiting for stream recovery", fallback: "Fallback polling active",
};

type FeedState = "receiving" | "waiting" | "unsupported" | "errored";

function receivedAt(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "Not yet recorded";
}

function ago(value: string | null | undefined, now: number) {
  return value ? relativeTime(new Date(value), now) : "never";
}

/** The current time, ticking with the 10-second diagnostics refresh. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function FeedStatus({ status }: { status: FeedState }) {
  const colors = { receiving: "var(--status-good)", waiting: "var(--text-secondary)", unsupported: "var(--text-muted)", errored: "var(--status-critical)" };
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium capitalize" style={{ color: colors[status] }}>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: colors[status] }} />
      {status}
    </span>
  );
}

export function ApiConnectionsPanel({ diagnostics, loading, error, vehicles, mockMode }: {
  diagnostics: RivianDiagnosticsResponse | undefined;
  loading: boolean;
  error: boolean;
  vehicles: VehicleDto[];
  mockMode: boolean;
}) {
  const now = useNow();
  const stream = diagnostics?.monitor.subscriptions;
  const cooldown = diagnostics?.traffic.cooldownUntil;
  const coolingDown = cooldown != null;
  const last24h = diagnostics?.traffic.last24h;
  const feeds = stream?.feeds ?? [];
  const receiving = feeds.filter((f) => f.status === "receiving").length;
  const lastData = feeds.map((f) => f.lastMessageAt).filter((t): t is string => t != null).sort().at(-1) ?? null;

  return (
    <>
      {error && (
        <p role="alert" className="text-sm text-[var(--status-critical)]">
          Could not refresh API status. {diagnostics ? "The values below may be out of date." : "Retrying automatically."}
        </p>
      )}

      {loading ? (
        <section className="card space-y-2 p-5">
          <Skeleton className="w-[6em]" />
          <Skeleton className="block h-7 w-[12em]" />
          <Skeleton className="w-[16em]" />
        </section>
      ) : (
        <SettingsHero {...connectionSummary(diagnostics, mockMode, now, { receiving, total: feeds.length, lastData })}>
          {last24h && !mockMode && (
            <HeroTiles
              tiles={[
                { label: "Requests · 24h", value: last24h.httpRequests.toLocaleString() },
                { label: "Reconnects · 24h", value: last24h.wsReconnects.toLocaleString() },
                { label: "Rate limited · 24h", value: last24h.rateLimited.toLocaleString(), tone: last24h.rateLimited > 0 ? "critical" : undefined },
                { label: "Session refreshes", value: last24h.sessionRefreshes.toLocaleString() },
              ]}
            />
          )}
        </SettingsHero>
      )}

      {loading ? (
        <SettingsGroup title="Feeds">
          <div className="space-y-4 p-4"><Skeleton className="w-full" /><Skeleton className="w-full" /><Skeleton className="w-full" /></div>
        </SettingsGroup>
      ) : !feeds.length ? (
        <SettingsGroup title="Feeds">
          <p className="px-4 py-4 text-sm text-[var(--text-secondary)]">
            {!diagnostics ? "Feed status is unavailable." : mockMode ? "Live subscription diagnostics are unavailable in demo mode." : diagnostics.monitor.running ? "Waiting for subscriptions to start." : "Monitoring is stopped. Connect your Rivian account to receive feeds."}
          </p>
        </SettingsGroup>
      ) : (
        (["Legacy", "Parallax"] as const).map((group) => {
          const list = feeds.filter((feed) => (group === "Legacy" ? feed.domain == null : feed.domain != null));
          if (!list.length) return null;
          return (
            <SettingsGroup
              key={group}
              ariaLabel={`${group} feeds`}
              title={`${group} feeds`}
              action={<span className="text-xs text-[var(--text-muted)]">{list.filter((f) => f.status === "receiving").length} of {list.length} receiving</span>}
              note={group === "Parallax" || !feeds.some((f) => f.domain != null) ? "Receiving means data arrived in the last 5 minutes. Waiting is normal while the vehicle sleeps or isn’t charging. Unsupported means Rivian declined the subscription." : undefined}
            >
              {list.map((feed) => (
                <div key={feed.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium capitalize">{feed.domain ?? feedNames[feed.kind]}</div>
                      <div className="text-xs text-[var(--text-muted)]" title={receivedAt(feed.lastMessageAt)}>
                        {vehicles.length > 1 && `${vehicles.find((v) => v.id === feed.vehicleId)?.name ?? vehicles.find((v) => v.id === feed.vehicleId)?.model ?? "Vehicle"} · `}
                        Last data: {ago(feed.lastMessageAt, now)}
                      </div>
                    </div>
                    <FeedStatus status={feed.status} />
                  </div>
                  {feed.topics.length > 0 && (
                    <details className="mt-1.5 text-xs text-[var(--text-secondary)]">
                      <summary className="cursor-pointer text-[var(--text-muted)] hover:text-[var(--text-secondary)]">{feed.topics.length} subscribed topics</summary>
                      <ul className="mt-2 space-y-1 break-all font-mono">{feed.topics.map((topic) => <li key={topic}>{topic}</li>)}</ul>
                    </details>
                  )}
                </div>
              ))}
            </SettingsGroup>
          );
        })
      )}

      <Disclosure title="Connection details">
        <LoadingScope loading={loading}>
          <h4 className="mb-2 text-xs uppercase tracking-wide text-[var(--text-muted)]">Legacy API</h4>
          <dl className="space-y-2 text-sm">
            <Row label="Last successful request" value={diagnostics ? receivedAt(diagnostics.traffic.lastSuccessfulRequestAt) : "—"} />
            <Row label="Vehicle-state polling" value={diagnostics ? coolingDown && diagnostics.monitor.running ? "Paused by rate-limit cooldown" : pollingLabels[diagnostics.monitor.pollingStatus] : "—"} />
            <Row label="Rate-limit cooldown" value={!diagnostics ? "—" : coolingDown ? `Paused until ${receivedAt(cooldown)}` : "None"} />
          </dl>
          <p className="mt-2 text-xs text-[var(--text-muted)]">Vehicle state normally arrives by subscription. Fallback polls run every 5 minutes while awake or 30 minutes while asleep, after stream recovery has been given time.</p>

          <h4 className="mb-2 mt-5 text-xs uppercase tracking-wide text-[var(--text-muted)]">Subscriptions</h4>
          <dl className="space-y-2 text-sm">
            <Row label="WebSocket" value={!diagnostics ? "—" : mockMode ? "Simulated" : stream ? <span className="capitalize">{stream.state}</span> : diagnostics.monitor.running ? "Starting" : "Stopped"} />
            <Row label="Reconnect attempts (24h)" value={diagnostics ? diagnostics.traffic.last24h.wsReconnects : "—"} />
            <Row label="Stream connects (24h)" value={diagnostics ? diagnostics.traffic.last24h.wsConnects : "—"} />
            <Row label="Last message received" value={diagnostics ? receivedAt(stream?.lastMessageAt) : "—"} />
          </dl>
          <p className="mt-2 text-xs text-[var(--text-muted)]">Socket messages include keepalives. Feed activity above measures data delivery.</p>

          {diagnostics && (Object.keys(diagnostics.traffic.requestsByOperation24h).length > 0 || diagnostics.monitor.parallaxDroppedFields.length > 0) && (
            <>
              <h4 className="mb-2 mt-5 text-xs uppercase tracking-wide text-[var(--text-muted)]">Requests · last 24 hours</h4>
              <dl className="space-y-2 text-sm">
                {Object.entries(diagnostics.traffic.requestsByOperation24h)
                  .sort((a, b) => b[1] - a[1])
                  .map(([op, n]) => <Row key={op} label={op} value={n} />)}
                {diagnostics.monitor.parallaxDroppedFields.length > 0 && (
                  <Row label="Fields Rivian rejected" value={diagnostics.monitor.parallaxDroppedFields.join(", ")} />
                )}
              </dl>
              <p className="mt-2 text-xs text-[var(--text-muted)]">Counters reset when the server restarts.</p>
            </>
          )}
        </LoadingScope>
      </Disclosure>
    </>
  );
}

/** The headline: is data flowing, and how. */
function connectionSummary(
  diagnostics: RivianDiagnosticsResponse | undefined,
  mockMode: boolean,
  now: number,
  feeds: { receiving: number; total: number; lastData: string | null },
): { tone: "good" | "warning" | "critical" | "muted" | "accent"; pulse?: boolean; eyebrow: string; headline: string; detail: ReactNode } {
  if (!diagnostics) return { tone: "muted", eyebrow: "Unavailable", headline: "Status unavailable", detail: "RivianMate couldn’t report its connection." };
  if (mockMode) return { tone: "accent", eyebrow: "Simulated", headline: "Demo data", detail: "A simulated vehicle; nothing is requested from Rivian." };
  const { monitor, traffic } = diagnostics;
  const stream = monitor.subscriptions;
  const lastData = feeds.lastData ?? stream?.lastMessageAt ?? null;
  if (traffic.cooldownUntil) {
    return {
      tone: "critical",
      eyebrow: "Rate limited",
      headline: `Paused until ${new Date(traffic.cooldownUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`,
      detail: "Rivian asked RivianMate to slow down. Requests resume automatically.",
    };
  }
  if (!monitor.running) return { tone: "muted", eyebrow: "Stopped", headline: "Not monitoring", detail: "Connect your Rivian account to start receiving data." };
  if (stream?.state === "connected") {
    return {
      tone: "good",
      pulse: true,
      eyebrow: "Live",
      headline: "Streaming from Rivian",
      detail: `Last data ${ago(lastData, now)}${feeds.total ? ` · ${feeds.receiving} of ${feeds.total} feeds receiving` : ""}`,
    };
  }
  if (monitor.fallbackPolling) {
    return { tone: "warning", eyebrow: "Polling", headline: "Checking in by polling", detail: "The live stream is down, so RivianMate asks every 5 minutes while awake or 30 while asleep." };
  }
  return {
    tone: "warning",
    eyebrow: stream?.state === "connecting" ? "Connecting" : "Reconnecting",
    headline: stream?.state === "connecting" ? "Connecting to Rivian" : "Reconnecting to Rivian",
    detail: `Last data ${ago(lastData, now)}`,
  };
}

function Disclosure(props: { title: string; children: ReactNode }) {
  return (
    <details className="card group">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
        {props.title}
        <svg viewBox="0 0 12 12" className="h-3 w-3 text-[var(--text-muted)] transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <path d="M2.5 4.5 6 8l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="border-t border-[var(--border)] p-4">{props.children}</div>
    </details>
  );
}
