import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import {
  api,
  type FeedLatestData,
  type RivianDiagnosticsResponse,
  type VehicleDto,
} from '../../api/client';
import { Dot } from '../../components/Dot';
import { LoadingScope, Skeleton } from '../../components/LoadingState';
import { Row } from '../../components/Panel';
import { relativeTime } from '../../lib/freshness';
import { dateTime } from '../../lib/format';
import { SettingsGroup, SettingsHero } from './SettingsControls';

const feedNames = {
  vehicleState: 'Vehicle state',
  parallax: 'Parallax',
  chargingSession: 'Charging',
  departureSchedules: 'Departure schedules',
};
const pollingLabels = {
  stopped: 'Stopped',
  standby: 'Off · live stream connected',
  waiting: 'Waiting for stream recovery',
  fallback: 'Fallback polling active',
};

/** A feed's row name: its Parallax domain, or the legacy subscription's name. */
function feedName(feed: { domain: string | null; kind: keyof typeof feedNames }) {
  return feed.domain ?? feedNames[feed.kind];
}

type FeedState = 'receiving' | 'waiting' | 'unsupported' | 'errored';

function receivedAt(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : 'Not yet recorded';
}

function ago(value: string | null | undefined, now: number) {
  return value ? relativeTime(new Date(value), now) : 'never';
}

/** The counters' window: the last day, or since the server started if that's sooner. */
function countedSince(since: string, now: number) {
  return now - Date.parse(since) < 24 * 3600_000 ? `since ${dateTime(since)}` : 'last 24 hours';
}

/**
 * What a feed last received, fetched when opened. Parallax feeds list each
 * topic's raw fields.
 */
function FeedLatest(props: { feedId: string; topics: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="mt-1.5 text-xs text-(--text-secondary)"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer text-(--text-muted) hover:text-(--text-secondary)">
        Latest data
        {props.topics.length > 0 &&
          ` · ${props.topics.length} ${props.topics.length === 1 ? 'topic' : 'topics'}`}
      </summary>
      {open && <FeedLatestBody feedId={props.feedId} topics={props.topics} />}
    </details>
  );
}

function FeedLatestBody(props: { feedId: string; topics: string[] }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ['feedLatest', props.feedId],
    queryFn: () => api.feedLatest(props.feedId),
    refetchInterval: 10_000,
  });
  if (isPending) return <p className="mt-2 text-(--text-muted)">Loading…</p>;
  if (isError)
    return <p className="mt-2 text-(--status-critical)">Couldn’t load the latest data.</p>;
  const byTopic = new Map(data.messages.map((m) => [m.topic, m]));
  const topics = props.topics.length > 0 ? props.topics : [null];
  return (
    <ul className="mt-2 space-y-3">
      {topics.map((topic) => {
        const m = byTopic.get(topic);
        return (
          <li key={topic ?? 'feed'}>
            {topic && <div className="break-all font-mono text-(--text-primary)">{topic}</div>}
            {m ? (
              <>
                <div className="text-(--text-muted)">
                  Received {new Date(m.receivedAt).toLocaleString()}
                </div>
                {m.fields ? (
                  <RawFields fields={m.fields} />
                ) : (
                  <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-(--surface-2) p-2 font-mono text-[11px] leading-snug">
                    {JSON.stringify(m.data, null, 2)}
                  </pre>
                )}
              </>
            ) : (
              <div className="text-(--text-muted)">Nothing received since the server started.</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A Parallax message's fields as Rivian sent them, with RivianMate's reading of each. */
function RawFields(props: { fields: NonNullable<FeedLatestData['messages'][number]['fields']> }) {
  if (props.fields.length === 0)
    return <div className="mt-1 text-(--text-muted)">Empty message.</div>;
  return (
    <div className="mt-1 max-h-64 overflow-auto rounded-md bg-(--surface-2)">
      <table className="w-full text-left text-[11px] leading-snug">
        <thead className="sticky top-0 bg-(--surface-2) text-(--text-muted)">
          <tr>
            <th className="px-2 py-1 font-medium">Field</th>
            <th className="px-2 py-1 font-medium">RivianMate reads it as</th>
            <th className="px-2 py-1 text-right font-medium">Value</th>
          </tr>
        </thead>
        <tbody>
          {props.fields.map((f, i) => (
            <tr key={i} className="border-t border-(--border)">
              <td className="whitespace-nowrap px-2 py-1 align-top font-mono">{f.path}</td>
              <td className="px-2 py-1 align-top">
                {f.name ?? <span className="text-(--text-muted)">—</span>}
              </td>
              <td className="break-all px-2 py-1 text-right align-top font-mono tabular-nums">
                {f.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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
  const colors = {
    receiving: 'var(--status-good)',
    waiting: 'var(--text-secondary)',
    unsupported: 'var(--text-muted)',
    errored: 'var(--status-critical)',
  };
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-medium capitalize"
      style={{ color: colors[status] }}
    >
      <Dot color={colors[status]} />
      {status}
    </span>
  );
}

export function ApiConnectionsPanel({
  diagnostics,
  loading,
  error,
  vehicles,
  mockMode,
}: {
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
  const counted = diagnostics ? countedSince(diagnostics.traffic.since, now) : '';
  const feeds = stream?.feeds ?? [];
  const vehicleName = (id: string) => {
    const vehicle = vehicles.find((v) => v.id === id);
    return vehicle?.name ?? vehicle?.model ?? 'Vehicle';
  };
  const receiving = feeds.filter((f) => f.status === 'receiving').length;
  const lastData =
    feeds
      .map((f) => f.lastMessageAt)
      .filter((t): t is string => t != null)
      .sort()
      .at(-1) ?? null;

  return (
    <>
      {error && (
        <p role="alert" className="text-sm text-(--status-critical)">
          Could not refresh API status.{' '}
          {diagnostics ? 'The values below may be out of date.' : 'Retrying automatically.'}
        </p>
      )}

      {loading ? (
        <section className="card space-y-2 p-5">
          <Skeleton className="w-[6em]" />
          <Skeleton className="block h-7 w-[12em]" />
          <Skeleton className="w-[16em]" />
        </section>
      ) : (
        <SettingsHero
          {...connectionSummary(diagnostics, mockMode, now, {
            receiving,
            total: feeds.length,
            lastData,
          })}
        />
      )}

      {loading ? (
        <SettingsGroup title="Feeds">
          <div className="space-y-4 p-4">
            <Skeleton className="w-full" />
            <Skeleton className="w-full" />
            <Skeleton className="w-full" />
          </div>
        </SettingsGroup>
      ) : !feeds.length ? (
        <SettingsGroup title="Feeds">
          <p className="px-4 py-4 text-sm text-(--text-secondary)">
            {!diagnostics
              ? 'Feed status is unavailable.'
              : mockMode
                ? 'Live subscription diagnostics are unavailable in demo mode.'
                : diagnostics.monitor.running
                  ? 'Waiting for subscriptions to start.'
                  : 'Monitoring is stopped. Connect your Rivian account to receive feeds.'}
          </p>
        </SettingsGroup>
      ) : (
        (['Legacy', 'Parallax'] as const).map((group) => {
          const list = feeds
            .filter((feed) => (group === 'Legacy' ? feed.domain == null : feed.domain != null))
            .sort(
              (a, b) =>
                feedName(a).localeCompare(feedName(b)) ||
                vehicleName(a.vehicleId).localeCompare(vehicleName(b.vehicleId)),
            );
          if (!list.length) return null;
          return (
            <SettingsGroup
              key={group}
              ariaLabel={`${group} feeds`}
              title={`${group} feeds`}
              action={
                <span className="text-xs text-(--text-muted)">
                  {list.filter((f) => f.status === 'receiving').length} of {list.length} receiving
                </span>
              }
              note={
                group === 'Parallax' || !feeds.some((f) => f.domain != null)
                  ? 'Receiving means data arrived in the last 5 minutes. Waiting is normal while the vehicle sleeps or isn’t charging. Unsupported means Rivian declined the subscription.'
                  : undefined
              }
            >
              {list.map((feed) => (
                <div key={feed.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium capitalize">{feedName(feed)}</div>
                      <div
                        className="text-xs text-(--text-muted)"
                        title={receivedAt(feed.lastMessageAt)}
                      >
                        {vehicles.length > 1 && `${vehicleName(feed.vehicleId)} · `}
                        Last data: {ago(feed.lastMessageAt, now)}
                      </div>
                    </div>
                    <FeedStatus status={feed.status} />
                  </div>
                  <FeedLatest feedId={feed.id} topics={feed.topics} />
                </div>
              ))}
            </SettingsGroup>
          );
        })
      )}

      <Disclosure title="Connection details">
        <LoadingScope loading={loading}>
          <h4 className="mb-2 text-xs uppercase tracking-wide text-(--text-muted)">Requests</h4>
          <dl className="space-y-2 text-sm">
            <Row
              label="Vehicle-state polling"
              value={
                diagnostics
                  ? coolingDown && diagnostics.monitor.running
                    ? 'Paused by rate-limit cooldown'
                    : pollingLabels[diagnostics.monitor.pollingStatus]
                  : '—'
              }
            />
            <Row
              label="Last successful request"
              value={diagnostics ? receivedAt(diagnostics.traffic.lastSuccessfulRequestAt) : '—'}
            />
            <Row
              label="Rate-limit cooldown"
              value={
                !diagnostics ? '—' : coolingDown ? `Paused until ${receivedAt(cooldown)}` : 'None'
              }
            />
          </dl>

          <h4 className="mb-2 mt-5 text-xs uppercase tracking-wide text-(--text-muted)">
            Live stream
          </h4>
          <dl className="space-y-2 text-sm">
            <Row
              label="WebSocket"
              value={
                !diagnostics ? (
                  '—'
                ) : mockMode ? (
                  'Simulated'
                ) : stream ? (
                  <span className="capitalize">{stream.state}</span>
                ) : diagnostics.monitor.running ? (
                  'Starting'
                ) : (
                  'Stopped'
                )
              }
            />
            <Row
              label="Last message received"
              value={diagnostics ? receivedAt(stream?.lastMessageAt) : '—'}
            />
            <Row
              label={`Dropped connections · ${counted}`}
              value={diagnostics ? diagnostics.traffic.last24h.wsDrops : '—'}
            />
          </dl>

          {diagnostics &&
            (Object.keys(diagnostics.traffic.requestsByOperation24h).length > 0 ||
              diagnostics.monitor.parallaxDroppedFields.length > 0) && (
              <>
                <h4 className="mb-2 mt-5 text-xs uppercase tracking-wide text-(--text-muted)">
                  Requests by operation · {counted}
                </h4>
                <dl className="space-y-2 text-sm">
                  {Object.entries(diagnostics.traffic.requestsByOperation24h)
                    .sort((a, b) => b[1] - a[1])
                    .map(([op, n]) => (
                      <Row key={op} label={op} value={n} />
                    ))}
                  {diagnostics.monitor.parallaxDroppedFields.length > 0 && (
                    <Row
                      label="Fields Rivian rejected"
                      value={diagnostics.monitor.parallaxDroppedFields.join(', ')}
                    />
                  )}
                </dl>
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
): {
  tone: 'good' | 'warning' | 'critical' | 'muted' | 'accent';
  pulse?: boolean;
  eyebrow: string;
  headline: string;
  detail: ReactNode;
} {
  if (!diagnostics)
    return {
      tone: 'muted',
      eyebrow: 'Unavailable',
      headline: 'Status unavailable',
      detail: 'RivianMate couldn’t report its connection.',
    };
  if (mockMode)
    return {
      tone: 'accent',
      eyebrow: 'Simulated',
      headline: 'Demo data',
      detail: 'A simulated vehicle; nothing is requested from Rivian.',
    };
  const { monitor, traffic } = diagnostics;
  const stream = monitor.subscriptions;
  const lastData = feeds.lastData ?? stream?.lastMessageAt ?? null;
  if (traffic.cooldownUntil) {
    return {
      tone: 'critical',
      eyebrow: 'Rate limited',
      headline: `Paused until ${new Date(traffic.cooldownUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`,
      detail: 'Rivian asked RivianMate to slow down. Requests resume automatically.',
    };
  }
  if (!monitor.running)
    return {
      tone: 'muted',
      eyebrow: 'Stopped',
      headline: 'Not monitoring',
      detail: 'Connect your Rivian account to start receiving data.',
    };
  if (stream?.state === 'connected') {
    return {
      tone: 'good',
      pulse: true,
      eyebrow: 'Live',
      headline: 'Streaming from Rivian',
      detail: `Last data ${ago(lastData, now)}${feeds.total ? ` · ${feeds.receiving} of ${feeds.total} feeds receiving` : ''}`,
    };
  }
  if (monitor.fallbackPolling) {
    return {
      tone: 'warning',
      eyebrow: 'Polling',
      headline: 'Checking in by polling',
      detail:
        'The live stream is down, so RivianMate asks every 5 minutes while awake or 30 while asleep.',
    };
  }
  return {
    tone: 'warning',
    eyebrow: stream?.state === 'connecting' ? 'Connecting' : 'Reconnecting',
    headline: stream?.state === 'connecting' ? 'Connecting to Rivian' : 'Reconnecting to Rivian',
    detail: `Last data ${ago(lastData, now)}`,
  };
}

function Disclosure(props: { title: string; children: ReactNode }) {
  return (
    <details className="card group">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
        {props.title}
        <svg
          viewBox="0 0 12 12"
          className="h-3 w-3 text-(--text-muted) transition-transform group-open:rotate-180"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden
        >
          <path d="M2.5 4.5 6 8l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="border-t border-(--border) p-4">{props.children}</div>
    </details>
  );
}
