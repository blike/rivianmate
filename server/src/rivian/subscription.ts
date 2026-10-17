import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import WebSocket from 'ws';
import { type Logger, silentLogger } from '../logger.js';
import { mapChargingSession } from './charging-session.js';
import { mapDepartureSchedules } from './departures.js';
import { RivianGovernor, parseRetryAfter } from './governor.js';
import {
  APOLLO_CLIENT_NAME,
  APOLLO_CLIENT_VERSION,
  CHARGING_SESSION_SUBSCRIPTION,
  DEPARTURE_SCHEDULES_SUBSCRIPTION,
  GRAPHQL_WEBSOCKET,
  PARALLAX_MESSAGES_SUBSCRIPTION,
  CORE_VEHICLE_STATE_PROPERTIES,
  SUBSCRIPTION_PROPERTIES,
  buildVehicleStateSubscription,
} from './graphql.js';
import {
  type ParallaxGroup,
  type ParallaxMessage,
  type RawField,
  describeParallax,
  domainOf,
} from './parallax/index.js';
import type {
  DepartureSchedule,
  LiveSessionData,
  RivianAppSession,
  VehicleState,
} from './types.js';

export type VehicleStateCallback = (vehicleId: string, state: VehicleState) => void;
export type ChargingSessionCallback = (vehicleId: string, session: LiveSessionData | null) => void;

export type DepartureSchedulesCallback = (
  vehicleId: string,
  schedules: DepartureSchedule[],
) => void;

export type ParallaxCallback = (vehicleId: string, message: ParallaxMessage) => void;

export interface VehicleStateStream {
  /** `vehicleId` is getUserInfo's vehicles[].id, not the VIN. */
  subscribe(vehicleId: string, callback: VehicleStateCallback): void;
  /** Live charging data; optional so simple streams can omit it. */
  subscribeCharging?(vehicleId: string, callback: ChargingSessionCallback): void;
  /** Departure schedules (subscription-only in Rivian's API). */
  subscribeDepartureSchedules?(vehicleId: string, callback: DepartureSchedulesCallback): void;
  /**
   * Parallax protobuf messages for the given topics (RVMs). Each group is
   * its own subscription with its own rejection fate, so a vehicle refusing
   * one group's topics keeps the others.
   */
  subscribeParallax?(
    vehicleId: string,
    rvms: readonly string[],
    callback: ParallaxCallback,
    group?: ParallaxGroup,
  ): void;
  /**
   * True once Rivian has refused an optional subscription, for one vehicle
   * or any; for Parallax, one group or any.
   */
  isUnsupported?(kind: OptionalSubKind, vehicleId?: string, group?: ParallaxGroup): boolean;
  /** Legacy fields Rivian has rejected from the subscription (for diagnostics). */
  readonly droppedFields?: readonly string[];
  diagnostics?(): StreamDiagnostics;
  /** What a feed last received, for diagnostics. */
  latestData?(feedId: string): FeedLatestData | null;
  start(): void;
  stop(): void;
  /**
   * Fires when Rivian rejects the socket's credentials. The stream keeps
   * retrying with backoff; the owner decides when to give up.
   */
  onAuthFailure?: () => void;
  /** Fires after a successful connection_ack (credentials accepted). */
  onAuthenticated?: () => void;
  /** Fires on connect/disconnect so the owner can fall back to polling. */
  onConnectionChange?: (connected: boolean) => void;
}

/** Rivian closes long-lived sockets on a schedule; just open a new one. */
export const CLOSE_CONNECTION_TTL_EXPIRED = 4420;
/** Server-side: the socket has no active subscriptions left. */
export const CLOSE_NO_ACTIVE_SUBSCRIPTIONS = 4410;
const AUTH_CLOSE_CODES = new Set([4401, 4403]);
const CLOSE_TOO_MANY_REQUESTS = 4429;

export interface SubscriptionManagerOptions {
  getCredentials: () => {
    userSessionToken?: string;
    appSession?: RivianAppSession;
  };
  governor: RivianGovernor;
  url?: string;
  log?: Logger;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  /** Delay before renewing after Rivian's scheduled TTL close. */
  ttlRenewDelayMs?: number;
  /** Transport-level ping cadence used to detect dead sockets. */
  heartbeatIntervalMs?: number;
}

type OptionalSubKind = 'chargingSession' | 'departureSchedules' | 'parallax';
type SubKind = 'vehicleState' | OptionalSubKind;

const isParallax = (kind: SubKind) => kind === 'parallax';

/** Keys that come with every legacy message, data or not. */
const NOT_DATA_KEYS = new Set(['cloudConnection', '__typename', 'timeStamp', 'updatedAt']);

/**
 * Whether a legacy message carries a reading: any value but null, an empty
 * list, or what comes with every message (the connection status, stamps).
 * Rivian accepts an R2's legacy subscriptions but sends only these.
 */
export function carriesData(value: unknown): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.some(carriesData);
  if (typeof value === 'object') {
    return Object.entries(value).some(([key, v]) => !NOT_DATA_KEYS.has(key) && carriesData(v));
  }
  return true;
}

export interface FeedDiagnostics {
  id: string;
  vehicleId: string;
  kind: SubKind;
  /** A Parallax feed's subscription group. */
  group: ParallaxGroup | null;
  domain: string | null;
  topics: string[];
  /**
   * empty: a legacy feed whose messages have only ever carried nulls (and
   * the connection status), as Rivian sends an R2. Its data isn't there.
   */
  status: 'receiving' | 'empty' | 'waiting' | 'unsupported' | 'errored';
  lastMessageAt: string | null;
}

/** The last message a feed received: per topic for a Parallax feed. */
export interface FeedLatestData {
  feedId: string;
  messages: {
    topic: string | null;
    receivedAt: string;
    /** A legacy feed's data, as Rivian sent it (vehicle state merged across messages). */
    data?: unknown;
    /** A Parallax topic's raw fields, with RivianMate's names for those it reads. */
    fields?: RawField[];
  }[];
}

export interface StreamDiagnostics {
  state: 'connected' | 'connecting' | 'reconnecting' | 'stopped';
  lastMessageAt: string | null;
  feeds: FeedDiagnostics[];
}

interface Subscription {
  id: string;
  kind: SubKind;
  vehicleId: string;
  lastMessageAt?: number;
  receivedOnConnection?: boolean;
  /** A legacy feed's messages have carried a reading since startup (see carriesData). */
  carriedData?: boolean;
  topicMessages?: Map<string, number>;
  topicsOnConnection?: Set<string>;
  errored?: boolean;
  onState?: VehicleStateCallback;
  onCharging?: ChargingSessionCallback;
  onDepartures?: DepartureSchedulesCallback;
  rvms?: readonly string[];
  group?: ParallaxGroup;
  onParallax?: ParallaxCallback;
  /** The last data received, for diagnostics: the whole payload, or per Parallax topic. */
  latest?: { at: number; data: unknown };
  latestByTopic?: Map<string, { at: number; message: ParallaxMessage }>;
}

/** The feeds a subscription shows as: one, or one per Parallax domain. */
function feedsOf(sub: Subscription): { id: string; domain: string | null; topics: string[] }[] {
  if (!isParallax(sub.kind)) {
    return [{ id: sub.id, domain: null, topics: [] }];
  }
  const domains = new Map<string, string[]>();
  for (const topic of sub.rvms ?? []) {
    const domain = domainOf(topic);
    domains.set(domain, [...(domains.get(domain) ?? []), topic]);
  }
  // Keyed by vehicle and domain, not group, so a domain split across groups
  // (dynamics: GPS and tires, and gear) shows as one feed.
  return [...domains].map(([domain, topics]) => ({
    id: `parallax:${sub.vehicleId}:${domain}`,
    domain,
    topics,
  }));
}

/** A feed, and the subscriptions carrying its topics. */
interface Feed {
  id: string;
  vehicleId: string;
  kind: SubKind;
  /** The group of the feed's first subscription. */
  group: ParallaxGroup | null;
  domain: string | null;
  topics: string[];
  parts: { sub: Subscription; topics: string[] }[];
}

/** One feed per legacy subscription, and per vehicle and Parallax domain. */
function feedsFrom(subs: Iterable<Subscription>): Feed[] {
  const feeds = new Map<string, Feed>();
  for (const sub of subs) {
    for (const { id, domain, topics } of feedsOf(sub)) {
      const feed = feeds.get(id);
      if (feed) {
        feed.topics.push(...topics);
        feed.parts.push({ sub, topics });
      } else {
        feeds.set(id, {
          id,
          vehicleId: sub.vehicleId,
          kind: sub.kind,
          group: sub.group ?? null,
          domain,
          topics: [...topics],
          parts: [{ sub, topics }],
        });
      }
    }
  }
  return [...feeds.values()];
}

/** A merged feed's status: errored or receiving if any part is, unsupported only if all are. */
const FEED_STATUS_ORDER: FeedDiagnostics['status'][] = [
  'errored',
  'receiving',
  'empty',
  'waiting',
  'unsupported',
];

type DisconnectReason =
  | { kind: 'ttl' }
  | { kind: 'auth' }
  | { kind: 'rateLimited'; retryAfterMs?: number }
  | { kind: 'error'; message: string };

/**
 * graphql-transport-ws client for Rivian's vehicle-state and charging-session
 * subscriptions. Designed to be a quiet, well-behaved client:
 *
 * - one socket, one subscription per (vehicle, kind), each sent exactly once
 *   per connection with a stable id (never re-sent on an idle socket);
 * - liveness is checked with transport-level ping frames, which cost Rivian
 *   nothing at the GraphQL layer;
 * - reconnects use exponential backoff with jitter (10s → 15min) and wait out
 *   any rate-limit cooldown held by the shared governor.
 */
export class RivianSubscriptionManager implements VehicleStateStream {
  private ws?: WebSocket;
  private subscriptions = new Map<string, Subscription>();
  /** Subscription ids sent on the current socket. */
  private sentIds = new Set<string>();
  private disabledFields = new Set<string>();
  /** Set when Rivian ends the full selection without saying why. */
  private coreFieldsOnly = false;
  /** Whether the current socket has delivered any vehicle state yet. */
  private gotVehicleData = false;
  /**
   * Ids of optional subscriptions Rivian refused; not re-sent for this
   * process. Per subscription, so one vehicle's refusal leaves the others'.
   */
  private unsupported = new Set<string>();
  private started = false;
  private connected = false;
  private everConnected = false;
  private lastMessageAt: number | null = null;
  private reconnectAttempt = 0;
  /** Reconnecting after Rivian's scheduled TTL close, which isn't worth a line at info. */
  private renewing = false;
  private reconnectTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private awaitingPong = false;
  /** Only enforce pongs once this connection has proven it answers pings. */
  private pongSeen = false;

  private readonly url: string;
  private readonly log: Logger;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly ttlRenewDelayMs: number;
  private readonly heartbeatIntervalMs: number;

  onAuthFailure?: () => void;
  onAuthenticated?: () => void;
  onConnectionChange?: (connected: boolean) => void;

  constructor(private readonly options: SubscriptionManagerOptions) {
    this.url = options.url ?? GRAPHQL_WEBSOCKET;
    this.log = options.log ?? silentLogger;
    this.initialBackoffMs = options.initialBackoffMs ?? 10_000;
    this.maxBackoffMs = options.maxBackoffMs ?? 15 * 60_000;
    this.ttlRenewDelayMs = options.ttlRenewDelayMs ?? 2_000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 60_000;
  }

  subscribe(vehicleId: string, callback: VehicleStateCallback): void {
    this.addSubscription({
      id: `vehicleState:${vehicleId}`,
      kind: 'vehicleState',
      vehicleId,
      onState: callback,
    });
  }

  subscribeCharging(vehicleId: string, callback: ChargingSessionCallback): void {
    this.addSubscription({
      id: `chargingSession:${vehicleId}`,
      kind: 'chargingSession',
      vehicleId,
      onCharging: callback,
    });
  }

  subscribeDepartureSchedules(vehicleId: string, callback: DepartureSchedulesCallback): void {
    this.addSubscription({
      id: `departureSchedules:${vehicleId}`,
      kind: 'departureSchedules',
      vehicleId,
      onDepartures: callback,
    });
  }

  subscribeParallax(
    vehicleId: string,
    rvms: readonly string[],
    callback: ParallaxCallback,
    group: ParallaxGroup = 'core',
  ): void {
    this.addSubscription({
      id: `parallax:${group}:${vehicleId}`,
      kind: 'parallax',
      vehicleId,
      rvms,
      group,
      onParallax: callback,
    });
  }

  /** Optional subscriptions Rivian refused, for one vehicle or any (for diagnostics/UI). */
  isUnsupported(kind: OptionalSubKind, vehicleId?: string, group?: ParallaxGroup): boolean {
    return [...this.subscriptions.values()].some(
      (sub) =>
        sub.kind === kind &&
        (vehicleId == null || sub.vehicleId === vehicleId) &&
        (group == null || sub.group === group) &&
        this.unsupported.has(sub.id),
    );
  }

  diagnostics(): StreamDiagnostics {
    const now = Date.now();
    return {
      state: !this.started
        ? 'stopped'
        : this.connected
          ? 'connected'
          : this.reconnectTimer
            ? 'reconnecting'
            : 'connecting',
      lastMessageAt: this.lastMessageAt == null ? null : new Date(this.lastMessageAt).toISOString(),
      feeds: feedsFrom(this.subscriptions.values()).map((feed): FeedDiagnostics => {
        const parts = feed.parts.map(({ sub, topics }) => {
          const lastMessageAt =
            feed.domain == null
              ? sub.lastMessageAt
              : topics.reduce<number | undefined>((latest, topic) => {
                  const at = sub.topicMessages?.get(topic);
                  return at == null ? latest : Math.max(latest ?? at, at);
                }, undefined);
          const received =
            feed.domain == null
              ? sub.receivedOnConnection
              : topics.some((topic) => sub.topicsOnConnection?.has(topic));
          const status: FeedDiagnostics['status'] = this.unsupported.has(sub.id)
            ? 'unsupported'
            : sub.errored && this.started
              ? 'errored'
              : feed.domain == null &&
                  this.connected &&
                  this.sentIds.has(sub.id) &&
                  lastMessageAt != null &&
                  !sub.carriedData
                ? 'empty'
                : this.connected &&
                    this.sentIds.has(sub.id) &&
                    received &&
                    lastMessageAt != null &&
                    now - lastMessageAt < 5 * 60_000
                  ? 'receiving'
                  : 'waiting';
          return { lastMessageAt, status };
        });
        const lastMessageAt = parts.reduce<number | undefined>(
          (latest, p) =>
            p.lastMessageAt == null ? latest : Math.max(latest ?? p.lastMessageAt, p.lastMessageAt),
          undefined,
        );
        return {
          id: feed.id,
          vehicleId: feed.vehicleId,
          kind: feed.kind,
          group: feed.group,
          domain: feed.domain,
          topics: feed.topics,
          status: FEED_STATUS_ORDER.find((s) => parts.some((p) => p.status === s))!,
          lastMessageAt: lastMessageAt == null ? null : new Date(lastMessageAt).toISOString(),
        };
      }),
    };
  }

  /** What a feed last received since startup; null for an unknown feed. */
  latestData(feedId: string): FeedLatestData | null {
    const feed = feedsFrom(this.subscriptions.values()).find((f) => f.id === feedId);
    if (!feed) return null;
    if (feed.domain == null) {
      const latest = feed.parts[0]!.sub.latest;
      return {
        feedId,
        messages: latest
          ? [{ topic: null, receivedAt: new Date(latest.at).toISOString(), data: latest.data }]
          : [],
      };
    }
    return {
      feedId,
      messages: feed.parts.flatMap(({ sub, topics }) =>
        topics.flatMap((topic) => {
          const latest = sub.latestByTopic?.get(topic);
          if (!latest) return [];
          return [
            {
              topic,
              receivedAt: new Date(latest.at).toISOString(),
              fields: describeParallax(latest.message),
            },
          ];
        }),
      ),
    };
  }

  private noteFeedMessage(sub: Subscription, data?: unknown): void {
    sub.lastMessageAt = Date.now();
    sub.receivedOnConnection = true;
    if (!isParallax(sub.kind) && carriesData(data)) sub.carriedData = true;
    if (data !== undefined) sub.latest = { at: sub.lastMessageAt, data };
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.connect();
  }

  stop(): void {
    this.started = false;
    this.clearTimers();
    const ws = this.ws;
    this.ws = undefined;
    if (ws) {
      ws.removeAllListeners();
      ws.on('error', () => {});
      if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'client stop');
      else ws.terminate();
    }
    this.sentIds.clear();
    this.setConnected(false);
  }

  get isConnected(): boolean {
    return this.connected;
  }

  /** True once the stream fell back to the core field set. */
  get usingCoreFieldsOnly(): boolean {
    return this.coreFieldsOnly;
  }

  /** Fields dropped after Rivian rejected them (for diagnostics). */
  get droppedFields(): string[] {
    return [...this.disabledFields];
  }

  private addSubscription(sub: Subscription): void {
    this.subscriptions.set(sub.id, sub);
    if (this.connected) this.sendSubscribe(sub);
  }

  private connect(): void {
    if (!this.started || this.ws) return;

    const cooldown = this.options.governor.cooldownRemainingMs();
    if (cooldown > 0) {
      this.log.info(`rate-limit cooldown active; connecting in ${Math.round(cooldown / 1000)}s`);
      this.scheduleReconnect(cooldown);
      return;
    }

    const { userSessionToken, appSession } = this.options.getCredentials();
    if (!userSessionToken) {
      this.log.warn('no user session token; not connecting');
      return;
    }

    const headers: Record<string, string> = { 'U-Sess': userSessionToken };
    if (appSession) {
      headers['A-Sess'] = appSession.appSessionToken;
      headers['Csrf-Token'] = appSession.csrfToken;
    }

    this.options.governor.count(this.everConnected ? 'wsReconnects' : 'wsConnects');
    const ws = new WebSocket(this.url, 'graphql-transport-ws', {
      headers,
      handshakeTimeout: 30_000,
    });
    this.ws = ws;
    let finished = false;
    const finish = (reason: DisconnectReason) => {
      if (finished) return;
      finished = true;
      this.handleDisconnect(ws, reason);
    };

    ws.on('unexpected-response', (req, res: IncomingMessage) => {
      const status = res.statusCode ?? 0;
      req.destroy();
      if (status === 401 || status === 403) finish({ kind: 'auth' });
      else if (status === 429) {
        const header = res.headers['retry-after'];
        finish({
          kind: 'rateLimited',
          retryAfterMs: parseRetryAfter(Array.isArray(header) ? header[0] : header),
        });
      } else finish({ kind: 'error', message: `handshake rejected (HTTP ${status})` });
    });

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          type: 'connection_init',
          payload: {
            'client-name': APOLLO_CLIENT_NAME,
            'client-version': APOLLO_CLIENT_VERSION,
            'dc-cid': `m-ios-${randomUUID()}`,
            'u-sess': userSessionToken,
          },
        }),
      );
    });

    ws.on('pong', () => {
      this.awaitingPong = false;
      this.pongSeen = true;
    });

    ws.on('message', (raw) => {
      this.awaitingPong = false;
      this.options.governor.count('wsMessages');
      let msg: { type: string; id?: string; payload?: unknown };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        this.log.debug({ bytes: raw.toString().length }, 'ignored a message that is not JSON');
        return;
      }
      this.lastMessageAt = Date.now();
      const reason = this.handleMessage(ws, msg);
      if (reason) {
        finish(reason);
        ws.close(1000);
      }
    });

    ws.on('close', (code, reasonBuf) => {
      const reason = reasonBuf?.toString() ?? '';
      if (code === CLOSE_CONNECTION_TTL_EXPIRED) finish({ kind: 'ttl' });
      else if (AUTH_CLOSE_CODES.has(code) || /unauthenticated|forbidden/i.test(reason)) {
        finish({ kind: 'auth' });
      } else if (code === CLOSE_TOO_MANY_REQUESTS) finish({ kind: 'rateLimited' });
      else finish({ kind: 'error', message: `closed (${code}${reason ? ` ${reason}` : ''})` });
    });

    ws.on('error', (err) => {
      finish({ kind: 'error', message: err.message });
      ws.terminate();
    });
  }

  /** Returns a disconnect reason when the message ends the connection. */
  private handleMessage(
    ws: WebSocket,
    msg: { type: string; id?: string; payload?: unknown },
  ): DisconnectReason | undefined {
    switch (msg.type) {
      case 'connection_ack':
        // Backoff is only reset once data actually flows: an accepted
        // handshake followed by an immediately-ended subscription must
        // still back off, or we'd reconnect every few seconds forever.
        this.everConnected = true;
        this.gotVehicleData = false;
        this.sentIds.clear();
        for (const sub of this.subscriptions.values()) {
          sub.receivedOnConnection = false;
          sub.topicsOnConnection?.clear();
          sub.errored = false;
        }
        this.log[this.renewing ? 'debug' : 'info']('connected');
        this.renewing = false;
        this.setConnected(true);
        this.onAuthenticated?.();
        this.startHeartbeat(ws);
        for (const sub of this.subscriptions.values()) this.sendSubscribe(sub);
        return undefined;
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        return undefined;
      case 'next': {
        const sub = msg.id ? this.subscriptions.get(msg.id) : undefined;
        if (!sub) return undefined;
        const payload = msg.payload as
          { data?: Record<string, unknown>; errors?: unknown[] } | undefined;
        const data = payload?.data;
        sub.errored = Array.isArray(payload?.errors) && payload.errors.length > 0;
        if (sub.kind === 'vehicleState') {
          const state = data?.vehicleState as VehicleState | undefined;
          if (state) {
            // Each message carries only what changed; keep every field's latest.
            this.noteFeedMessage(sub, { ...(sub.latest?.data as VehicleState), ...state });
            if (!this.gotVehicleData) {
              this.gotVehicleData = true;
              this.reconnectAttempt = 0;
            }
            sub.onState?.(sub.vehicleId, state);
          }
        } else if (sub.kind === 'chargingSession' && data && 'chargingSession' in data) {
          this.noteFeedMessage(sub, data.chargingSession);
          sub.onCharging?.(sub.vehicleId, mapChargingSession(data.chargingSession));
        } else if (
          sub.kind === 'departureSchedules' &&
          data &&
          'vehicleDepartureSchedules' in data
        ) {
          this.noteFeedMessage(sub, data.vehicleDepartureSchedules);
          sub.onDepartures?.(sub.vehicleId, mapDepartureSchedules(data.vehicleDepartureSchedules));
        } else if (isParallax(sub.kind) && data && 'parallaxMessages' in data) {
          const m = data.parallaxMessages as Partial<Record<keyof ParallaxMessage, unknown>> | null;
          if (m && typeof m.rvm === 'string') {
            this.noteFeedMessage(sub);
            // Only subscribed topics contribute to domain health.
            if (sub.rvms?.includes(m.rvm)) {
              (sub.topicMessages ??= new Map()).set(m.rvm, Date.now());
              (sub.topicsOnConnection ??= new Set()).add(m.rvm);
            }
            const timestamp = Number(m.timestamp);
            const message: ParallaxMessage = {
              rvm: m.rvm,
              payload: typeof m.payload === 'string' ? m.payload : '',
              timestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null,
            };
            (sub.latestByTopic ??= new Map()).set(m.rvm, { at: Date.now(), message });
            sub.onParallax?.(sub.vehicleId, message);
          }
        }
        return undefined;
      }
      case 'error':
      case 'complete':
        return this.handleSubscriptionEnd(msg);
      default:
        return undefined;
    }
  }

  private handleSubscriptionEnd(msg: {
    type: string;
    id?: string;
    payload?: unknown;
  }): DisconnectReason | undefined {
    const sub = msg.id ? this.subscriptions.get(msg.id) : undefined;
    if (msg.id) this.sentIds.delete(msg.id);
    if (sub) sub.errored = msg.type === 'error';
    const errors = Array.isArray(msg.payload)
      ? (msg.payload as { message?: string; extensions?: { code?: string } }[])
      : [];
    if (errors.some((e) => e?.extensions?.code === 'UNAUTHENTICATED')) {
      return { kind: 'auth' };
    }
    if (errors.some((e) => e?.extensions?.code === 'RATE_LIMIT')) {
      return { kind: 'rateLimited' };
    }

    if (sub && sub.kind !== 'vehicleState') {
      // Optional feature: if Rivian refuses it, keep the socket (charging
      // keeps its vehicle-state data; schedules show as unavailable).
      if (msg.type === 'error') {
        this.unsupported.add(sub.id);
        this.log.warn(
          `${sub.group ? `parallax ${sub.group}` : sub.kind} subscription rejected: ${summarize(errors)}`,
        );
      }
      return undefined;
    }

    const rejected = rejectedFields(errors);
    for (const field of rejected) this.disabledFields.add(field);
    if (rejected.length) {
      this.log.warn(`vehicle state subscription rejected fields: ${rejected.join(', ')}`);
    } else if (!this.gotVehicleData && !this.coreFieldsOnly) {
      // Ended before any data and without naming a field: most likely a
      // schema mismatch somewhere in the selection. Fall back to core fields.
      this.coreFieldsOnly = true;
      this.log.warn(
        'vehicle state subscription ended without data; retrying with core fields only',
      );
    }
    return {
      kind: 'error',
      message: `vehicle state subscription ${msg.type}${errors.length ? `: ${summarize(errors)}` : ''}`,
    };
  }

  private sendSubscribe(sub: Subscription): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.sentIds.has(sub.id)) return;
    if (this.unsupported.has(sub.id)) return;
    this.sentIds.add(sub.id);
    const payload =
      sub.kind === 'vehicleState'
        ? {
            operationName: 'VehicleState',
            query: buildVehicleStateSubscription(
              (this.coreFieldsOnly
                ? CORE_VEHICLE_STATE_PROPERTIES
                : SUBSCRIPTION_PROPERTIES
              ).filter((p) => !this.disabledFields.has(p)),
            ),
            variables: { vehicleID: sub.vehicleId },
          }
        : sub.kind === 'chargingSession'
          ? {
              operationName: 'chargingSession',
              query: CHARGING_SESSION_SUBSCRIPTION,
              variables: { vehicleID: sub.vehicleId },
            }
          : isParallax(sub.kind)
            ? {
                operationName: 'ParallaxMessages',
                query: PARALLAX_MESSAGES_SUBSCRIPTION,
                // Parallax takes `vehicleId`, unlike the legacy `vehicleID`.
                variables: { vehicleId: sub.vehicleId, rvms: sub.rvms ?? [] },
              }
            : {
                operationName: 'vehicleDepartureSchedules',
                query: DEPARTURE_SCHEDULES_SUBSCRIPTION,
                variables: { vehicleID: sub.vehicleId },
              };
    this.ws.send(JSON.stringify({ id: sub.id, type: 'subscribe', payload }));
  }

  private handleDisconnect(ws: WebSocket, reason: DisconnectReason): void {
    if (this.ws !== ws) return;
    const wasConnected = this.connected;
    this.ws = undefined;
    this.sentIds.clear();
    this.stopHeartbeat();
    this.setConnected(false);
    this.renewing = false;
    if (!this.started) return;

    switch (reason.kind) {
      case 'ttl':
        // Scheduled renewal by Rivian: not an error, don't escalate backoff.
        this.log.debug('connection TTL expired; renewing');
        this.renewing = true;
        this.reconnectAttempt = 0;
        this.scheduleReconnect(this.ttlRenewDelayMs);
        return;
      case 'auth':
        this.log.error('credentials rejected');
        this.options.governor.count('wsAuthFailures');
        this.onAuthFailure?.();
        break;
      case 'rateLimited': {
        const cooldown = this.options.governor.noteRateLimited(reason.retryAfterMs);
        this.log.warn(`rate limited; pausing ${Math.round(cooldown / 1000)}s`);
        break;
      }
      case 'error':
        this.log.warn(
          wasConnected
            ? `connection dropped: ${reason.message}`
            : `connection failed: ${reason.message}`,
        );
        // A failed attempt to connect isn't a lost connection.
        if (wasConnected) this.options.governor.count('wsDrops');
        break;
    }
    if (!this.started) return; // onAuthFailure may have stopped us
    this.scheduleReconnect(this.nextBackoffMs());
  }

  private nextBackoffMs(): number {
    const base = Math.min(this.initialBackoffMs * 2 ** this.reconnectAttempt, this.maxBackoffMs);
    this.reconnectAttempt += 1;
    return base + Math.random() * base * 0.25;
  }

  private scheduleReconnect(delayMs: number): void {
    if (!this.started || this.reconnectTimer) return;
    const delay = Math.max(delayMs, this.options.governor.cooldownRemainingMs());
    this.log.debug(`reconnecting in ${Math.round(delay / 1000)}s`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, delay);
  }

  /** Transport ping/pong: no GraphQL traffic, just detects dead sockets. */
  private startHeartbeat(ws: WebSocket): void {
    this.stopHeartbeat();
    this.awaitingPong = false;
    this.pongSeen = false;
    this.heartbeatTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      // Without a prior pong we can't tell "dead" from "doesn't answer pings";
      // keep pinging (it still keeps NAT paths open) but don't drop the socket.
      if (this.awaitingPong && this.pongSeen) {
        this.log.warn('heartbeat missed; dropping socket');
        ws.terminate();
        return;
      }
      this.awaitingPong = true;
      ws.ping();
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  private setConnected(connected: boolean): void {
    if (this.connected === connected) return;
    this.connected = connected;
    this.onConnectionChange?.(connected);
  }

  private clearTimers(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }
}

function summarize(errors: { message?: string }[]): string {
  const messages = errors
    .map((e) => e?.message)
    .filter(Boolean)
    .join('; ');
  return (messages || JSON.stringify(errors)).slice(0, 500);
}

/** Pulls field names out of GraphQL validation errors. */
export function rejectedFields(errors: { message?: string }[]): string[] {
  const fields = new Set<string>();
  for (const e of errors) {
    const match = e?.message?.match(/Cannot query field ["']([A-Za-z0-9_]+)["']/);
    if (match?.[1] && SUBSCRIPTION_PROPERTIES.includes(match[1])) fields.add(match[1]);
  }
  return [...fields];
}
