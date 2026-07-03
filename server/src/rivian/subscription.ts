import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import {
  APOLLO_CLIENT_NAME,
  APOLLO_CLIENT_VERSION,
  GRAPHQL_WEBSOCKET,
  SUBSCRIPTION_PROPERTIES,
  buildVehicleStateSubscription,
} from "./graphql.js";
import type { VehicleState } from "./types.js";

export type VehicleStateCallback = (vin: string, state: VehicleState) => void;

export interface VehicleStateStream {
  subscribe(vin: string, callback: VehicleStateCallback): void;
  start(): void;
  stop(): void;
  /** Fires when the server rejects the session; the account must re-login. */
  onUnauthenticated?: () => void;
  /** Fires on connect/disconnect so the monitor can fall back to polling. */
  onConnectionChange?: (connected: boolean) => void;
}

const IDLE_TIMEOUT_MS = 60_000;
const MAX_BACKOFF_MS = 300_000;

interface Subscription {
  vin: string;
  callback: VehicleStateCallback;
  wsId?: string;
}

/**
 * graphql-transport-ws client for Rivian's vehicle state subscription,
 * ported from rivian-python-client's ws_monitor.py.
 */
export class RivianSubscriptionManager implements VehicleStateStream {
  private ws?: WebSocket;
  private subscriptions = new Map<string, Subscription>();
  private started = false;
  private connected = false;
  private reconnectAttempt = 0;
  private idleTimer?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;

  onUnauthenticated?: () => void;
  onConnectionChange?: (connected: boolean) => void;

  constructor(
    private readonly getUserSessionToken: () => string | undefined,
    private readonly url: string = GRAPHQL_WEBSOCKET,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  subscribe(vin: string, callback: VehicleStateCallback): void {
    this.subscriptions.set(vin, { vin, callback });
    if (this.connected) this.sendSubscribe(this.subscriptions.get(vin)!);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.connect();
  }

  stop(): void {
    this.started = false;
    this.clearTimers();
    this.ws?.removeAllListeners();
    this.ws?.close();
    this.ws = undefined;
    this.setConnected(false);
  }

  get isConnected(): boolean {
    return this.connected;
  }

  private connect(): void {
    if (!this.started) return;
    const token = this.getUserSessionToken();
    if (!token) {
      this.log("no user session token; not connecting");
      return;
    }

    const ws = new WebSocket(this.url, "graphql-transport-ws");
    this.ws = ws;

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "connection_init",
          payload: {
            "client-name": APOLLO_CLIENT_NAME,
            "client-version": APOLLO_CLIENT_VERSION,
            "dc-cid": `m-ios-${randomUUID()}`,
            "u-sess": token,
          },
        }),
      );
    });

    ws.on("message", (raw) => {
      this.touchIdleTimer();
      let msg: { type: string; id?: string; payload?: unknown };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      switch (msg.type) {
        case "connection_ack":
          this.reconnectAttempt = 0;
          this.setConnected(true);
          for (const sub of this.subscriptions.values()) this.sendSubscribe(sub);
          break;
        case "next": {
          const payload = msg.payload as
            | { data?: { vehicleState?: VehicleState } }
            | undefined;
          const state = payload?.data?.vehicleState;
          if (!state) break;
          for (const sub of this.subscriptions.values()) {
            if (sub.wsId === msg.id) sub.callback(sub.vin, state);
          }
          break;
        }
        case "error": {
          const errors = msg.payload as { extensions?: { code?: string } }[];
          if (errors?.some((e) => e?.extensions?.code === "UNAUTHENTICATED")) {
            this.log("subscription unauthenticated");
            this.stop();
            this.onUnauthenticated?.();
          }
          break;
        }
        default:
          break;
      }
    });

    ws.on("close", (code, reason) => {
      this.setConnected(false);
      if (reason?.toString() === "Unauthenticated") {
        this.stop();
        this.onUnauthenticated?.();
        return;
      }
      this.scheduleReconnect();
    });

    ws.on("error", (err) => {
      this.log(`websocket error: ${err.message}`);
      ws.close();
    });
  }

  private sendSubscribe(sub: Subscription): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    sub.wsId = randomUUID();
    this.ws.send(
      JSON.stringify({
        id: sub.wsId,
        type: "subscribe",
        payload: {
          operationName: "VehicleState",
          query: buildVehicleStateSubscription(SUBSCRIPTION_PROPERTIES),
          variables: { vehicleID: sub.vin },
        },
      }),
    );
  }

  /** No traffic for 60s: assume a stale connection and resubscribe. */
  private touchIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (!this.started) return;
      this.log("idle timeout; resubscribing");
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        for (const sub of this.subscriptions.values()) this.sendSubscribe(sub);
        this.touchIdleTimer();
      } else {
        this.ws?.close();
      }
    }, IDLE_TIMEOUT_MS);
  }

  private scheduleReconnect(): void {
    if (!this.started || this.reconnectTimer) return;
    const delay = Math.min(
      2 ** this.reconnectAttempt * 1000 + Math.random() * 1000,
      MAX_BACKOFF_MS,
    );
    this.reconnectAttempt += 1;
    this.log(`reconnecting in ${Math.round(delay / 1000)}s`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, delay);
  }

  private setConnected(connected: boolean): void {
    if (this.connected === connected) return;
    this.connected = connected;
    this.onConnectionChange?.(connected);
  }

  private clearTimers(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.idleTimer = undefined;
    this.reconnectTimer = undefined;
  }
}
