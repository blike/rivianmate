import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  api,
  type FeedLatestData,
  type FeedTopic,
  type RivianDiagnosticsResponse,
  type VehicleDto,
} from '../../api/client';
import { Skeleton } from '../../components/LoadingState';
import { StatTiles } from '../../components/StatTiles';
import { relativeTime } from '../../lib/freshness';
import { dateTime } from '../../lib/format';
import { SegmentedControl, SettingsGroup, SettingsHero } from './SettingsControls';

type Feed = NonNullable<RivianDiagnosticsResponse['monitor']['subscriptions']>['feeds'][number];
type FeedState = Feed['status'];

const feedNames = {
  vehicleState: 'Vehicle state',
  parallax: 'Parallax',
  chargingSession: 'Charging',
  departureSchedules: 'Departure schedules',
};
const pollingLabels = {
  stopped: 'Stopped',
  standby: 'Off',
  waiting: 'Waiting',
  fallback: 'Polling',
};
const pollingDetails = {
  stopped: 'Monitoring is stopped',
  standby: 'Live stream connected',
  waiting: 'For the stream to recover',
  fallback: 'Every 5 min awake, 30 asleep',
};

/** Parallax domains that aren't simply capitalized. */
const domainNames: Record<string, string> = { ota: 'OTA', device_table: 'Devices' };

const domainName = (domain: string) =>
  domainNames[domain] ?? (domain.charAt(0).toUpperCase() + domain.slice(1)).replaceAll('_', ' ');

/** A topic's name within its domain: `charging.session.status` is `session.status`. */
const shortTopic = (rvm: string) => rvm.slice(rvm.indexOf('.') + 1);

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

/** The current time, ticking with the 10-second diagnostics refresh. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const feedStatus: Record<FeedState, { label: string; color: string; help: string }> = {
  receiving: {
    label: 'Receiving',
    color: 'var(--status-good)',
    help: 'Data arrived in the last 5 minutes.',
  },
  waiting: {
    label: 'Waiting',
    color: 'var(--text-secondary)',
    help: 'Nothing in the last 5 minutes: normal while the vehicle sleeps or isn’t charging.',
  },
  empty: {
    label: 'No data',
    color: 'var(--text-muted)',
    help: 'Rivian accepted the subscription but only sends empty readings.',
  },
  unsupported: {
    label: 'Unsupported',
    color: 'var(--text-muted)',
    help: 'Rivian declined the subscription for this vehicle.',
  },
  errored: {
    label: 'Errored',
    color: 'var(--status-critical)',
    help: 'Rivian reported an error on its last message.',
  },
};

function FeedStatus({ status }: { status: FeedState }) {
  const s = feedStatus[status];
  return (
    <span className="shrink-0 text-xs font-medium" style={{ color: s.color }} title={s.help}>
      {s.label}
    </span>
  );
}

type TopicFilter = 'all' | FeedTopic['kind'] | 'quiet';

const topicFilters: { value: TopicFilter; label: string; help: string }[] = [
  { value: 'all', label: 'All', help: 'Every topic' },
  { value: 'read', label: 'Read', help: 'Topics RivianMate uses' },
  {
    value: 'probe',
    label: 'Probe',
    help: 'Archived to be worked out; nothing reads them yet',
  },
  {
    value: 'unregistered',
    label: 'Not kept',
    help: 'Sent by Rivian but unknown to RivianMate: seen by name and size, never stored',
  },
  {
    value: 'quiet',
    label: 'Quiet',
    help: 'Known topics that haven’t arrived since the server started',
  },
];

const kindLabels: Record<FeedTopic['kind'], string> = {
  read: 'Read',
  probe: 'Probe',
  unregistered: 'Not kept',
};

const filterHelp = (value: TopicFilter) => topicFilters.find((f) => f.value === value)!.help;

/** Whether a topic shows under a filter. */
export function matchesFilter(topic: FeedTopic, filter: TopicFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'quiet') return topic.kind !== 'unregistered' && topic.lastMessageAt == null;
  return topic.kind === filter;
}

/** What RivianMate does with a Parallax topic, beside its name. */
function KindTag(props: { kind: FeedTopic['kind'] }) {
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full border border-(--border) px-2 text-[11px] leading-4 font-medium text-(--text-muted)"
      title={filterHelp(props.kind)}
    >
      {kindLabels[props.kind]}
    </span>
  );
}

/**
 * A row's last column, the same width in every row and centered in it, so
 * the times before it line up whatever status or tag it holds.
 */
function EndSlot(props: { children: ReactNode }) {
  return <span className="flex w-24 shrink-0 justify-center">{props.children}</span>;
}

/** When a row last had data, in a centered column of its own; sentence case, like the labels. */
function TimeSlot(props: { title: string; children: string }) {
  const text = props.children;
  return (
    <span className="w-20 shrink-0 text-center text-xs text-(--text-muted)" title={props.title}>
      {text.charAt(0).toUpperCase() + text.slice(1)}
    </span>
  );
}

function Chevron() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className="h-3 w-3 shrink-0 text-(--text-muted) transition-transform group-open/row:rotate-90"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A row that opens to show more; its body mounts only once opened. */
function ExpandRow(props: { summary: ReactNode; children: () => ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className={`group/row ${props.className ?? ''}`}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2.5 hover:bg-(--surface-2) focus-visible:bg-(--surface-2) focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <Chevron />
        {props.summary}
      </summary>
      {open && props.children()}
    </details>
  );
}

function useFeedLatest(feedId: string) {
  return useQuery({
    queryKey: ['feedLatest', feedId],
    queryFn: () => api.feedLatest(feedId),
    refetchInterval: 10_000,
  });
}

/** A Parallax message's fields as Rivian sent them, with RivianMate's reading of each. */
function RawFields(props: { fields: NonNullable<FeedLatestData['messages'][number]['fields']> }) {
  if (props.fields.length === 0)
    return <div className="text-(--text-muted)">Empty message: every field is zero.</div>;
  return (
    <div className="max-h-64 overflow-auto rounded-md bg-(--surface-2)">
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

/** A legacy subscription: its status, and what it last sent when opened. */
function LegacyFeedRow(props: { feed: Feed; now: number }) {
  const { feed } = props;
  return (
    <ExpandRow
      summary={
        <>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {feedNames[feed.kind]}
          </span>
          <TimeSlot title={receivedAt(feed.lastMessageAt)}>
            {ago(feed.lastMessageAt, props.now)}
          </TimeSlot>
          <EndSlot>
            <FeedStatus status={feed.status} />
          </EndSlot>
        </>
      }
    >
      {() => <LegacyFeedBody feedId={feed.id} />}
    </ExpandRow>
  );
}

function LegacyFeedBody(props: { feedId: string }) {
  const { data, isPending, isError } = useFeedLatest(props.feedId);
  const m = data?.messages[0];
  return (
    <div className="px-4 pb-3 pl-10 text-xs">
      {isPending ? (
        <p className="text-(--text-muted)">Loading…</p>
      ) : isError ? (
        <p className="text-(--status-critical)">Couldn’t load the latest data.</p>
      ) : !m ? (
        <p className="text-(--text-muted)">Nothing received since the server started.</p>
      ) : (
        <>
          <p className="mb-1 text-(--text-muted)">
            Latest, received {new Date(m.receivedAt).toLocaleString()}
          </p>
          <pre className="max-h-64 overflow-auto rounded-md bg-(--surface-2) p-2 font-mono text-[11px] leading-snug">
            {JSON.stringify(m.data, null, 2)}
          </pre>
        </>
      )}
    </div>
  );
}

/** A Parallax domain: its topics matching the filter, listed once opened. */
function DomainRow(props: { feed: Feed; topics: FeedTopic[]; filtered: boolean; now: number }) {
  const { feed, topics } = props;
  const notKept = topics.filter((t) => t.kind === 'unregistered').length;
  const onlyNotKept = feed.topics.every((t) => t.kind === 'unregistered');
  const count = props.filtered
    ? `${topics.length} of ${feed.topics.length} topics`
    : `${topics.length} ${topics.length === 1 ? 'topic' : 'topics'}`;
  return (
    <ExpandRow
      summary={
        <>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{domainName(feed.domain!)}</span>
            <span className="block truncate text-xs text-(--text-muted)">
              {count}
              {!props.filtered && notKept > 0 && !onlyNotKept && ` · ${notKept} not kept`}
            </span>
          </span>
          <TimeSlot title={receivedAt(feed.lastMessageAt)}>
            {ago(feed.lastMessageAt, props.now)}
          </TimeSlot>
          <EndSlot>
            {onlyNotKept ? <KindTag kind="unregistered" /> : <FeedStatus status={feed.status} />}
          </EndSlot>
        </>
      }
    >
      {() => <DomainTopics feedId={feed.id} topics={topics} now={props.now} />}
    </ExpandRow>
  );
}

/** A domain's topics, each opening to what it last sent. */
function DomainTopics(props: { feedId: string; topics: FeedTopic[]; now: number }) {
  const { data, isPending, isError } = useFeedLatest(props.feedId);
  const byTopic = new Map(data?.messages.map((m) => [m.topic, m]));
  if (isError)
    return (
      <p className="px-4 pb-3 pl-10 text-xs text-(--status-critical)">
        Couldn’t load the latest data.
      </p>
    );
  return (
    <ul className="pb-1.5 pl-6">
      {props.topics.map((topic) => (
        <li key={topic.rvm}>
          <ExpandRow
            summary={
              <>
                <span
                  className="min-w-0 flex-1 truncate font-mono text-xs text-(--text-primary)"
                  title={topic.rvm}
                >
                  {shortTopic(topic.rvm)}
                </span>
                <TimeSlot title={receivedAt(topic.lastMessageAt)}>
                  {topic.lastMessageAt == null ? 'Quiet' : ago(topic.lastMessageAt, props.now)}
                </TimeSlot>
                <EndSlot>
                  <KindTag kind={topic.kind} />
                </EndSlot>
              </>
            }
          >
            {() => (
              <TopicDetail
                topic={topic}
                message={byTopic.get(topic.rvm)}
                archived={isPending ? undefined : (data?.lastArchivedAt?.[topic.rvm] ?? null)}
              />
            )}
          </ExpandRow>
        </li>
      ))}
    </ul>
  );
}

/**
 * What a topic last sent: its fields, or for one not kept how often it
 * came, or for a quiet one when it last changed (`archived` undefined while
 * that's loading). Exported for tests.
 */
export function TopicDetail(props: {
  topic: FeedTopic;
  message: FeedLatestData['messages'][number] | undefined;
  archived: string | null | undefined;
}) {
  const { topic, message: m, archived } = props;
  return (
    <div className="space-y-1 px-4 pb-3 pl-10 text-xs text-(--text-muted)">
      <p className="break-all font-mono">{topic.rvm}</p>
      {topic.kind === 'unregistered' ? (
        <p>
          Seen {topic.count} {topic.count === 1 ? 'time' : 'times'}
          {m?.bytes != null && `, ${m.bytes} bytes last`} since the server started. RivianMate
          doesn’t know this topic, so its contents are never kept.
        </p>
      ) : topic.lastMessageAt == null ? (
        <p>
          Nothing since the server started.{' '}
          {archived === undefined
            ? ''
            : archived
              ? `Last changed ${new Date(archived).toLocaleString()}.`
              : 'Never archived: this vehicle may not send it.'}
        </p>
      ) : (
        <>
          <p>
            {topic.count} {topic.count === 1 ? 'message' : 'messages'} since the server started
            {m && `, the latest ${new Date(m.receivedAt).toLocaleString()}`}.
          </p>
          {m?.fields ? <RawFields fields={m.fields} /> : <p>Loading…</p>}
        </>
      )}
    </div>
  );
}

/** What each status and topic label means, once, under the feeds. */
function LabelKey() {
  return (
    <section aria-label="Legend" className="px-1">
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-(--text-muted)">
        Legend
      </h3>
      <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        <div>
          <h4 className="mb-2 text-xs font-medium text-(--text-secondary)">Feeds</h4>
          <dl className="space-y-1.5 text-xs">
            {(Object.keys(feedStatus) as FeedState[]).map((status) => (
              <div key={status} className="flex items-baseline gap-3">
                <dt className="w-24 shrink-0">
                  <FeedStatus status={status} />
                </dt>
                <dd className="text-(--text-muted)">{feedStatus[status].help}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div>
          <h4 className="mb-2 text-xs font-medium text-(--text-secondary)">Parallax topics</h4>
          <dl className="space-y-1.5 text-xs">
            {(['read', 'probe', 'unregistered'] as const).map((kind) => (
              <div key={kind} className="flex items-baseline gap-3">
                <dt className="w-24 shrink-0">
                  <KindTag kind={kind} />
                </dt>
                <dd className="text-(--text-muted)">{filterHelp(kind)}.</dd>
              </div>
            ))}
            <div className="flex items-baseline gap-3">
              <dt className="w-24 shrink-0 text-(--text-secondary)">Quiet</dt>
              <dd className="text-(--text-muted)">{filterHelp('quiet')}.</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}

/** Parallax, by domain, narrowed to one kind of topic or the quiet ones. */
function ParallaxTopics(props: { feeds: Feed[]; now: number }) {
  const [filter, setFilter] = useState<TopicFilter>('all');
  const all = props.feeds.flatMap((f) => f.topics);
  const counts = Object.fromEntries(
    topicFilters.map((f) => [f.value, all.filter((t) => matchesFilter(t, f.value)).length]),
  ) as Record<TopicFilter, number>;
  const domains = props.feeds
    .map((feed) => ({ feed, topics: feed.topics.filter((t) => matchesFilter(t, filter)) }))
    .filter((d) => d.topics.length > 0)
    .sort((a, b) => domainName(a.feed.domain!).localeCompare(domainName(b.feed.domain!)));
  const receiving = props.feeds.filter((f) => f.status === 'receiving').length;
  return (
    <SettingsGroup
      ariaLabel="Parallax feeds"
      title="Parallax"
      action={
        <span className="text-xs text-(--text-muted)">
          {receiving} of {props.feeds.length} domains receiving
        </span>
      }
    >
      <div role="radiogroup" aria-label="Show topics" className="flex flex-wrap gap-1.5 px-4 py-3">
        {topicFilters.map((f) => (
          <button
            key={f.value}
            type="button"
            role="radio"
            aria-checked={f.value === filter}
            title={f.help}
            disabled={counts[f.value] === 0 && f.value !== filter}
            onClick={() => setFilter(f.value)}
            className={`rounded-full px-2.5 py-0.5 text-xs transition-colors disabled:opacity-40 ${
              f.value === filter
                ? 'bg-(--accent) font-medium text-(--on-accent)'
                : 'bg-(--surface-2) text-(--text-secondary) hover:text-(--text-primary)'
            }`}
          >
            {f.label} <span className="tabular-nums opacity-75">{counts[f.value]}</span>
          </button>
        ))}
      </div>
      {domains.map(({ feed, topics }) => (
        <DomainRow
          key={feed.id}
          feed={feed}
          topics={topics}
          filtered={filter !== 'all'}
          now={props.now}
        />
      ))}
    </SettingsGroup>
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
  const feeds = useMemo(() => stream?.feeds ?? [], [stream]);
  const feedVehicles = [...new Set(feeds.map((f) => f.vehicleId))];
  const [chosen, setChosen] = useState<string | null>(null);
  const vehicleId = chosen && feedVehicles.includes(chosen) ? chosen : (feedVehicles[0] ?? null);
  const vehicleName = (id: string) => {
    const vehicle = vehicles.find((v) => v.id === id);
    return vehicle?.name ?? vehicle?.model ?? 'Vehicle';
  };
  const mine = feeds.filter((f) => f.vehicleId === vehicleId);
  const legacy = mine
    .filter((f) => f.domain == null)
    .sort((a, b) => feedNames[a.kind].localeCompare(feedNames[b.kind]));
  const parallax = mine.filter((f) => f.domain != null);
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
        <SettingsHero {...connectionSummary(diagnostics, mockMode, lastData, now)}>
          {diagnostics && !mockMode && <HealthTiles diagnostics={diagnostics} now={now} />}
        </SettingsHero>
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
        <>
          {feedVehicles.length > 1 && vehicleId && (
            <div className="overflow-x-auto">
              <SegmentedControl
                label="Vehicle"
                value={vehicleId}
                options={feedVehicles.map((id) => ({ value: id, label: vehicleName(id) }))}
                onChange={setChosen}
              />
            </div>
          )}
          {legacy.length > 0 && (
            <SettingsGroup
              ariaLabel="Legacy feeds"
              title="Legacy API"
              action={
                <span className="text-xs text-(--text-muted)">
                  {legacy.filter((f) => f.status === 'receiving').length} of {legacy.length}{' '}
                  receiving
                </span>
              }
            >
              {legacy.map((feed) => (
                <LegacyFeedRow key={feed.id} feed={feed} now={now} />
              ))}
            </SettingsGroup>
          )}
          {parallax.length > 0 && <ParallaxTopics feeds={parallax} now={now} />}
          <LabelKey />
        </>
      )}
    </>
  );
}

/** The stream's health at a glance, under the headline. */
function HealthTiles(props: { diagnostics: RivianDiagnosticsResponse; now: number }) {
  const { monitor, traffic } = props.diagnostics;
  const stream = monitor.subscriptions;
  const paused = traffic.cooldownUntil != null && monitor.running;
  return (
    <StatTiles
      columns="sm:grid-cols-4"
      tiles={[
        {
          label: 'Live stream',
          value: (
            <span className="capitalize">
              {stream ? stream.state : monitor.running ? 'Starting' : 'Stopped'}
            </span>
          ),
          sub: `Last message ${ago(stream?.lastMessageAt, props.now)}`,
        },
        {
          label: 'Dropped connections',
          value: traffic.last24h.wsDrops,
          sub: countedSince(traffic.since, props.now),
        },
        {
          label: 'Fallback polling',
          value: paused ? 'Paused' : pollingLabels[monitor.pollingStatus],
          sub: paused ? 'By rate-limit cooldown' : pollingDetails[monitor.pollingStatus],
        },
        {
          label: 'Last request',
          value: traffic.lastSuccessfulRequestAt
            ? ago(traffic.lastSuccessfulRequestAt, props.now)
            : '—',
          sub: traffic.cooldownUntil
            ? `Paused until ${new Date(traffic.cooldownUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
            : 'No rate limit',
        },
      ]}
    />
  );
}

/** The headline: is data flowing, and how. */
function connectionSummary(
  diagnostics: RivianDiagnosticsResponse | undefined,
  mockMode: boolean,
  feedData: string | null,
  now: number,
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
  const lastData = feedData ?? stream?.lastMessageAt ?? null;
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
      detail: `Last data ${ago(lastData, now)}`,
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
