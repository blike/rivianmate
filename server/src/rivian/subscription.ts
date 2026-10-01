import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import WebSocket from "ws";
import { mapChargingSession } from "./charging-session.js";
import { RivianGovernor, parseRetryAfter } from "./governor.js";
import {
  APOLLO_CLIENT_NAME,
  APOLLO_CLIENT_VERSION,
  CHARGING_SESSION_SUBSCRIPTION,
  DEPARTURE_SCHEDULES_SUBSCRIPTION,
  GRAPHQL_WEBSOCKET,
  CORE_VEHICLE_STATE_PROPERTIES,
  SUBSCRIPTION_PROPERTIES,
  buildVehicleStateSubscription,
} from "./graphql.js";
import type {
  DepartureSchedule,
  LiveSessionData,
  RivianAppSession,
  VehicleState,
} from "./types.js";

export type VehicleStateCallback = (vehicleId: string, state: VehicleState) => void;
export type ChargingSessionCallback = (
  vehicleId: string,
  session: LiveSessionData | null,
) => void;

export type DepartureSchedulesCallback = (
  vehicleId: string,
  schedules: DepartureSchedule[],
) => void;

export interface VehicleStateStream {
  /** `vehicleId` is getUserInfo's vehicles[].id, not the VIN. */
  subscribe(vehicleId: string, callback: VehicleStateCallback): void;
  /** Live charging data; optional so simple streams can omit it. */
  subscribeCharging?(vehicleId: string, callback: ChargingSessionCallback): void;
  /** Departure schedules (subscription-only in Rivian's API). */
  subscribeDepartureSchedules?(vehicleId: string, callback: DepartureSchedulesCallback): void;
  /** True once Rivian has refused an optional subscription. */
  isUnsupported?(kind: "chargingSession" | "departureSchedules"): boolean;
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
  log?: (msg: string) => void;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  /** Delay before renewing after Rivian's scheduled TTL close. */
  ttlRenewDelayMs?: number;
  /** Transport-level ping cadence used to detect dead sockets. */
  heartbeatIntervalMs?: number;
}

type SubKind = "vehicleState" | "chargingSession" | "departureSchedules";

interface Subscription {
  id: string;
  kind: SubKind;
  vehicleId: string;
  onState?: VehicleStateCallback;
  onCharging?: ChargingSessionCallback;
  onDepartures?: DepartureSchedulesCallback;
}

type DisconnectReason =
  | { kind: "ttl" }
  | { kind: "auth" }
  | { kind: "rateLimited"; retryAfterMs?: number }
  | { kind: "error"; message: string };

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
  /** Optional subscriptions Rivian refused; not re-sent for this process. */
  private unsupported = new Set<SubKind>();
  private started = false;
  private connected = false;
  private everConnected = false;
  private reconnectAttempt = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private awaitingPong = false;
  /** Only enforce pongs once this connection has proven it answers pings. */
  private pongSeen = false;

  private readonly url: string;
  private readonly log: (msg: string) => void;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly ttlRenewDelayMs: number;
  private readonly heartbeatIntervalMs: number;

  onAuthFailure?: () => void;
  onAuthenticated?: () => void;
  onConnectionChange?: (connected: boolean) => void;

  constructor(private readonly options: SubscriptionManagerOptions) {
    this.url = options.url ?? GRAPHQL_WEBSOCKET;
    this.log = options.log ?? (() => {});
    this.initialBackoffMs = options.initialBackoffMs ?? 10_000;
    this.maxBackoffMs = options.maxBackoffMs ?? 15 * 60_000;
    this.ttlRenewDelayMs = options.ttlRenewDelayMs ?? 2_000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 60_000;
  }

  subscribe(vehicleId: string, callback: VehicleStateCallback): void {
    this.addSubscription({
      id: `vehicleState:${vehicleId}`,
      kind: "vehicleState",
      vehicleId,
      onState: callback,
    });
  }

  subscribeCharging(vehicleId: string, callback: ChargingSessionCallback): void {
    this.addSubscription({
      id: `chargingSession:${vehicleId}`,
      kind: "chargingSession",
      vehicleId,
      onCharging: callback,
    });
  }

  subscribeDepartureSchedules(vehicleId: string, callback: DepartureSchedulesCallback): void {
    this.addSubscription({
      id: `departureSchedules:${vehicleId}`,
      kind: "departureSchedules",
      vehicleId,
      onDepartures: callback,
    });
  }

  /** Optional subscriptions Rivian refused (for diagnostics/UI). */
  isUnsupported(kind: "chargingSession" | "departureSchedules"): boolean {
    return this.unsupported.has(kind);
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
      ws.on("error", () => {});
      if (ws.readyState === WebSocket.OPEN) ws.close(1000, "client stop");
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
      this.log(`rate-limit cooldown active; connecting in ${Math.round(cooldown / 1000)}s`);
      this.scheduleReconnect(cooldown);
      return;
    }

    const { userSessionToken, appSession } = this.options.getCredentials();
    if (!userSessionToken) {
      this.log("no user session token; not connecting");
      return;
    }

    const headers: Record<string, string> = { "U-Sess": userSessionToken };
    if (appSession) {
      headers["A-Sess"] = appSession.appSessionToken;
      headers["Csrf-Token"] = appSession.csrfToken;
    }

    this.options.governor.count(this.everConnected ? "wsReconnects" : "wsConnects");
    const ws = new WebSocket(this.url, "graphql-transport-ws", {
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

    ws.on("unexpected-response", (req, res: IncomingMessage) => {
      const status = res.statusCode ?? 0;
      req.destroy();
      if (status === 401 || status === 403) finish({ kind: "auth" });
      else if (status === 429) {
        const header = res.headers["retry-after"];
        finish({
          kind: "rateLimited",
          retryAfterMs: parseRetryAfter(Array.isArray(header) ? header[0] : header),
        });
      } else finish({ kind: "error", message: `handshake rejected (HTTP ${status})` });
    });

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "connection_init",
          payload: {
            "client-name": APOLLO_CLIENT_NAME,
            "client-version": APOLLO_CLIENT_VERSION,
            "dc-cid": `m-ios-${randomUUID()}`,
            "u-sess": userSessionToken,
          },
        }),
      );
    });

    ws.on("pong", () => {
      this.awaitingPong = false;
      this.pongSeen = true;
    });

    ws.on("message", (raw) => {
      this.awaitingPong = false;
      this.options.governor.count("wsMessages");
      let msg: { type: string; id?: string; payload?: unknown };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const reason = this.handleMessage(ws, msg);
      if (reason) {
        finish(reason);
        ws.close(1000);
      }
    });

    ws.on("close", (code, reasonBuf) => {
      const reason = reasonBuf?.toString() ?? "";
      if (code === CLOSE_CONNECTION_TTL_EXPIRED) finish({ kind: "ttl" });
      else if (AUTH_CLOSE_CODES.has(code) || /unauthenticated|forbidden/i.test(reason)) {
        finish({ kind: "auth" });
      } else if (code === CLOSE_TOO_MANY_REQUESTS) finish({ kind: "rateLimited" });
      else finish({ kind: "error", message: `closed (${code}${reason ? ` ${reason}` : ""})` });
    });

    ws.on("error", (err) => {
      finish({ kind: "error", message: err.message });
      ws.terminate();
    });
  }

  /** Returns a disconnect reason when the message ends the connection. */
  private handleMessage(
    ws: WebSocket,
    msg: { type: string; id?: string; payload?: unknown },
  ): DisconnectReason | undefined {
    switch (msg.type) {
      case "connection_ack":
        // Backoff is only reset once data actually flows: an accepted
        // handshake followed by an immediately-ended subscription must
        // still back off, or we'd reconnect every few seconds forever.
        this.everConnected = true;
        this.gotVehicleData = false;
        this.sentIds.clear();
        this.setConnected(true);
        this.onAuthenticated?.();
        this.startHeartbeat(ws);
        for (const sub of this.subscriptions.values()) this.sendSubscribe(sub);
        return undefined;
      case "ping":
        ws.send(JSON.stringify({ type: "pong" }));
        return undefined;
      case "next": {
        const sub = msg.id ? this.subscriptions.get(msg.id) : undefined;
        if (!sub) return undefined;
        const data = (msg.payload as { data?: Record<string, unknown> } | undefined)
          ?.data;
        if (sub.kind === "vehicleState") {
          const state = data?.vehicleState as VehicleState | undefined;
          if (state) {
            if (!this.gotVehicleData) {
              this.gotVehicleData = true;
              this.reconnectAttempt = 0;
            }
            sub.onState?.(sub.vehicleId, state);
          }
        } else if (sub.kind === "chargingSession" && data && "chargingSession" in data) {
          sub.onCharging?.(sub.vehicleId, mapChargingSession(data.chargingSession));
        } else if (sub.kind === "departureSchedules" && data && "vehicleDepartureSchedules" in data) {
          const list = data.vehicleDepartureSchedules;
          sub.onDepartures?.(sub.vehicleId, Array.isArray(list) ? (list as DepartureSchedule[]) : []);
        }
        return undefined;
      }
      case "error":
      case "complete":
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
    const errors = Array.isArray(msg.payload)
      ? (msg.payload as { message?: string; extensions?: { code?: string } }[])
      : [];
    if (errors.some((e) => e?.extensions?.code === "UNAUTHENTICATED")) {
      return { kind: "auth" };
    }
    if (errors.some((e) => e?.extensions?.code === "RATE_LIMIT")) {
      return { kind: "rateLimited" };
    }

    if (sub && sub.kind !== "vehicleState") {
      // Optional feature: if Rivian refuses it, keep the socket (charging
      // falls back to the REST safety net; schedules show as unavailable).
      if (msg.type === "error") {
        this.unsupported.add(sub.kind);
        this.log(`${sub.kind} subscription rejected: ${summarize(errors)}`);
      }
      return undefined;
    }

    const rejected = rejectedFields(errors);
    for (const field of rejected) this.disabledFields.add(field);
    if (rejected.length) {
      this.log(`vehicle state subscription rejected fields: ${rejected.join(", ")}`);
    } else if (!this.gotVehicleData && !this.coreFieldsOnly) {
      // Ended before any data and without naming a field: most likely a
      // schema mismatch somewhere in the selection. Fall back to core fields.
      this.coreFieldsOnly = true;
      this.log("vehicle state subscription ended without data; retrying with core fields only");
    }
    return {
      kind: "error",
      message: `vehicle state subscription ${msg.type}${errors.length ? `: ${summarize(errors)}` : ""}`,
    };
  }

  private sendSubscribe(sub: Subscription): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.sentIds.has(sub.id)) return;
    if (this.unsupported.has(sub.kind)) return;
    this.sentIds.add(sub.id);
    const payload =
      sub.kind === "vehicleState"
        ? {
            operationName: "VehicleState",
            query: buildVehicleStateSubscription(
              (this.coreFieldsOnly
                ? CORE_VEHICLE_STATE_PROPERTIES
                : SUBSCRIPTION_PROPERTIES
              ).filter((p) => !this.disabledFields.has(p)),
            ),
            variables: { vehicleID: sub.vehicleId },
          }
        : sub.kind === "chargingSession"
          ? {
              operationName: "chargingSession",
              query: CHARGING_SESSION_SUBSCRIPTION,
              variables: { vehicleID: sub.vehicleId },
            }
          : {
              operationName: "vehicleDepartureSchedules",
              query: DEPARTURE_SCHEDULES_SUBSCRIPTION,
              variables: { vehicleID: sub.vehicleId },
            };
    this.ws.send(JSON.stringify({ id: sub.id, type: "subscribe", payload }));
  }

  private handleDisconnect(ws: WebSocket, reason: DisconnectReason): void {
    if (this.ws !== ws) return;
    this.ws = undefined;
    this.sentIds.clear();
    this.stopHeartbeat();
    this.setConnected(false);
    if (!this.started) return;

    switch (reason.kind) {
      case "ttl":
        // Scheduled renewal by Rivian: not an error, don't escalate backoff.
        this.log("connection TTL expired; renewing");
        this.reconnectAttempt = 0;
        this.scheduleReconnect(this.ttlRenewDelayMs);
        return;
      case "auth":
        this.log("credentials rejected");
        this.options.governor.count("wsAuthFailures");
        this.onAuthFailure?.();
        break;
      case "rateLimited": {
        const cooldown = this.options.governor.noteRateLimited(reason.retryAfterMs);
        this.log(`rate limited; pausing ${Math.round(cooldown / 1000)}s`);
        break;
      }
      case "error":
        this.log(reason.message);
        break;
    }
    if (!this.started) return; // onAuthFailure may have stopped us
    this.scheduleReconnect(this.nextBackoffMs());
  }

  private nextBackoffMs(): number {
    const base = Math.min(
      this.initialBackoffMs * 2 ** this.reconnectAttempt,
      this.maxBackoffMs,
    );
    this.reconnectAttempt += 1;
    return base + Math.random() * base * 0.25;
  }

  private scheduleReconnect(delayMs: number): void {
    if (!this.started || this.reconnectTimer) return;
    const delay = Math.max(delayMs, this.options.governor.cooldownRemainingMs());
    this.log(`reconnecting in ${Math.round(delay / 1000)}s`);
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
        this.log("heartbeat missed; dropping socket");
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
  const messages = errors.map((e) => e?.message).filter(Boolean).join("; ");
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
