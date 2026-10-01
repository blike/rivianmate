import type { IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { RivianGovernor } from "./governor.js";
import {
  CLOSE_CONNECTION_TTL_EXPIRED,
  RivianSubscriptionManager,
  rejectedFields,
} from "./subscription.js";
import type { LiveSessionData, VehicleState } from "./types.js";

interface Received {
  type: string;
  id?: string;
  payload?: { query?: string; operationName?: string };
}

interface ServerConn {
  socket: WebSocket;
  headers: IncomingHttpHeaders;
  messages: Received[];
}

/** Minimal graphql-transport-ws server standing in for Rivian. */
class FakeRivian {
  readonly wss: WebSocketServer;
  readonly conns: ServerConn[] = [];
  private waiters: (() => void)[] = [];

  constructor(options: { autoPong?: boolean } = {}) {
    this.wss = new WebSocketServer({ port: 0, autoPong: options.autoPong ?? true });
    this.wss.on("connection", (socket, req) => {
      const conn: ServerConn = { socket, headers: req.headers, messages: [] };
      this.conns.push(conn);
      socket.on("message", (raw) => {
        const msg = JSON.parse(raw.toString()) as Received;
        conn.messages.push(msg);
        if (msg.type === "connection_init") {
          socket.send(JSON.stringify({ type: "connection_ack" }));
        }
        this.notify();
      });
      this.notify();
    });
  }

  get url(): string {
    return `ws://127.0.0.1:${(this.wss.address() as AddressInfo).port}`;
  }

  /** Resolves once `predicate` holds (checked on every server event). */
  async until(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error("timed out waiting");
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, 25);
      });
    }
  }

  subscribes(conn: ServerConn): Received[] {
    return conn.messages.filter((m) => m.type === "subscribe");
  }

  close(): Promise<void> {
    for (const c of this.conns) c.socket.terminate();
    return new Promise((resolve) => this.wss.close(() => resolve()));
  }

  private notify(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w();
  }
}

describe("RivianSubscriptionManager", () => {
  let server: FakeRivian;
  let manager: RivianSubscriptionManager;

  beforeEach(() => {
    server = new FakeRivian();
  });

  afterEach(async () => {
    manager?.stop();
    await server.close();
  });

  function createManager(
    overrides: { initialBackoffMs?: number; heartbeatIntervalMs?: number } = {},
  ) {
    return new RivianSubscriptionManager({
      url: server.url,
      governor: new RivianGovernor({ minSpacingMs: 0 }),
      getCredentials: () => ({
        userSessionToken: "usess",
        appSession: { appSessionToken: "asess", csrfToken: "csrf" },
      }),
      initialBackoffMs: overrides.initialBackoffMs ?? 50,
      ttlRenewDelayMs: 10,
      heartbeatIntervalMs: overrides.heartbeatIntervalMs,
    });
  }

  it("sends session headers and subscribes once per vehicle and kind", async () => {
    manager = createManager();
    const states: VehicleState[] = [];
    const sessions: (LiveSessionData | null)[] = [];
    manager.subscribe("VIN1", (_vin, s) => states.push(s));
    manager.subscribeCharging("VIN1", (_vin, s) => sessions.push(s));
    manager.start();

    await server.until(() => server.conns[0] !== undefined && server.subscribes(server.conns[0]).length === 2);
    const conn = server.conns[0]!;
    expect(conn.headers["u-sess"]).toBe("usess");
    expect(conn.headers["a-sess"]).toBe("asess");
    expect(conn.headers["csrf-token"]).toBe("csrf");
    expect(conn.headers["sec-websocket-protocol"]).toBe("graphql-transport-ws");
    expect(server.subscribes(conn).map((m) => m.id).sort()).toEqual([
      "chargingSession:VIN1",
      "vehicleState:VIN1",
    ]);

    // Re-registering a callback must not produce a duplicate subscribe.
    manager.subscribe("VIN1", (_vin, s) => states.push(s));
    conn.socket.send(
      JSON.stringify({
        id: "vehicleState:VIN1",
        type: "next",
        payload: { data: { vehicleState: { batteryLevel: { timeStamp: "t", value: 80 } } } },
      }),
    );
    conn.socket.send(
      JSON.stringify({
        id: "chargingSession:VIN1",
        type: "next",
        payload: { data: { chargingSession: { liveData: { powerKW: 11 }, chartData: [] } } },
      }),
    );
    await server.until(() => states.length === 1 && sessions.length === 1);
    expect(server.subscribes(conn)).toHaveLength(2);
    expect(states[0]!.batteryLevel).toEqual({ timeStamp: "t", value: 80 });
    expect(sessions[0]!.power?.value).toBe(11);
  });

  it("answers protocol pings with pongs", async () => {
    manager = createManager();
    manager.subscribe("VIN1", () => {});
    manager.start();
    await server.until(() => server.conns[0] !== undefined && server.subscribes(server.conns[0]).length === 1);
    const conn = server.conns[0]!;
    conn.socket.send(JSON.stringify({ type: "ping" }));
    await server.until(() => conn.messages.some((m) => m.type === "pong"));
  });

  it("renews quickly after Rivian's connection TTL close", async () => {
    // A large backoff proves the TTL path doesn't use it.
    manager = createManager({ initialBackoffMs: 60_000 });
    manager.subscribe("VIN1", () => {});
    manager.start();
    await server.until(() => server.conns[0] !== undefined && server.subscribes(server.conns[0]).length === 1);
    server.conns[0]!.socket.close(CLOSE_CONNECTION_TTL_EXPIRED, "Connection TTL expired");
    await server.until(() => server.conns[1] !== undefined && server.subscribes(server.conns[1]).length === 1);
    expect(server.subscribes(server.conns[1]!)[0]!.id).toBe("vehicleState:VIN1");
  });

  it("reports auth failures and keeps retrying with backoff", async () => {
    manager = createManager();
    let failures = 0;
    manager.onAuthFailure = () => {
      failures += 1;
    };
    manager.subscribe("VIN1", () => {});
    manager.start();
    await server.until(() => server.conns[0] !== undefined && server.subscribes(server.conns[0]).length === 1);
    server.conns[0]!.socket.send(
      JSON.stringify({
        id: "vehicleState:VIN1",
        type: "error",
        payload: [{ message: "nope", extensions: { code: "UNAUTHENTICATED" } }],
      }),
    );
    await server.until(() => failures === 1 && server.conns.length === 2);
  });

  it("drops a field Rivian rejects and resubscribes without it", async () => {
    manager = createManager();
    manager.subscribe("VIN1", () => {});
    manager.start();
    await server.until(() => server.conns[0] !== undefined && server.subscribes(server.conns[0]).length === 1);
    expect(server.subscribes(server.conns[0]!)[0]!.payload?.query).toContain("seatRearLeftHeat");
    server.conns[0]!.socket.send(
      JSON.stringify({
        id: "vehicleState:VIN1",
        type: "error",
        payload: [{ message: 'Cannot query field "seatRearLeftHeat" on type "VehicleState".' }],
      }),
    );
    await server.until(() => server.conns[1] !== undefined && server.subscribes(server.conns[1]).length === 1);
    const query = server.subscribes(server.conns[1]!)[0]!.payload?.query ?? "";
    expect(query).not.toContain("seatRearLeftHeat");
    expect(query).toContain("batteryLevel");
    expect(manager.droppedFields).toEqual(["seatRearLeftHeat"]);
    expect(manager.usingCoreFieldsOnly).toBe(false);
  });

  it("does not churn sockets when the server never answers pings", async () => {
    await server.close();
    server = new FakeRivian({ autoPong: false });
    manager = createManager({ heartbeatIntervalMs: 20 });
    manager.subscribe("VIN1", () => {});
    manager.start();
    await server.until(() => server.conns[0] !== undefined && server.subscribes(server.conns[0]).length === 1);
    await new Promise((r) => setTimeout(r, 200));
    expect(server.conns).toHaveLength(1);
    expect(manager.isConnected).toBe(true);
  });

  it("drops a socket that stops answering pings after it has answered before", async () => {
    manager = createManager({ heartbeatIntervalMs: 30 });
    manager.subscribe("VIN1", () => {});
    manager.start();
    await server.until(() => server.conns[0] !== undefined && server.subscribes(server.conns[0]).length === 1);
    await new Promise((r) => setTimeout(r, 100)); // at least one pong observed
    server.conns[0]!.socket.pause(); // stop reading: pings go unanswered
    await server.until(() => server.conns.length === 2, 3_000);
  });

  it("backs off when the subscription keeps ending without data", async () => {
    // Rivian accepts the handshake, then immediately completes the subscription.
    server.wss.on("connection", (socket) => {
      socket.on("message", (raw) => {
        const msg = JSON.parse(raw.toString()) as Received;
        if (msg.type === "subscribe") {
          socket.send(JSON.stringify({ id: msg.id, type: "complete" }));
        }
      });
    });
    const connectedAt: number[] = [];
    server.wss.on("connection", () => connectedAt.push(Date.now()));
    manager = createManager({ initialBackoffMs: 60 });
    manager.subscribe("VIN1", () => {});
    manager.start();
    await server.until(() => connectedAt.length >= 4, 5_000);
    const gaps = connectedAt.slice(1).map((t, i) => t - connectedAt[i]!);
    // 60 → 120 → 240ms (+≤25% jitter): must grow, not reset on each ack.
    expect(gaps[2]!).toBeGreaterThan(gaps[0]! * 2);
  });

  it("falls back to core fields when the subscription ends silently", async () => {
    server.wss.on("connection", (socket) => {
      socket.on("message", (raw) => {
        const msg = JSON.parse(raw.toString()) as Received;
        if (msg.type === "subscribe" && server.conns.length === 1) {
          socket.send(JSON.stringify({ id: msg.id, type: "complete" }));
        }
      });
    });
    manager = createManager();
    manager.subscribe("VIN1", () => {});
    manager.start();
    await server.until(() => server.conns[1] !== undefined && server.subscribes(server.conns[1]).length === 1);
    const query = server.subscribes(server.conns[1]!)[0]!.payload?.query ?? "";
    expect(manager.usingCoreFieldsOnly).toBe(true);
    expect(query).toContain("batteryLevel");
    expect(query).toContain("gnssLocation");
    expect(query).not.toContain("seatRearLeftHeat");
  });

  it("resets the backoff once vehicle data arrives", async () => {
    let completes = 0;
    server.wss.on("connection", (socket) => {
      socket.on("message", (raw) => {
        const msg = JSON.parse(raw.toString()) as Received;
        if (msg.type !== "subscribe") return;
        if (completes < 3) {
          completes += 1;
          socket.send(JSON.stringify({ id: msg.id, type: "complete" }));
        } else {
          socket.send(JSON.stringify({
            id: msg.id,
            type: "next",
            payload: { data: { vehicleState: { batteryLevel: { timeStamp: "t", value: 1 } } } },
          }));
          setTimeout(() => socket.close(4000, "bye"), 20);
        }
      });
    });
    const connectedAt: number[] = [];
    server.wss.on("connection", () => connectedAt.push(Date.now()));
    manager = createManager({ initialBackoffMs: 60 });
    manager.subscribe("VIN1", () => {});
    manager.start();
    await server.until(() => connectedAt.length >= 5, 5_000);
    // Attempts 1-3 escalate (60,120,240); after data the next wait is ~60 again.
    const lastGap = connectedAt[4]! - connectedAt[3]!;
    expect(lastGap).toBeLessThan(200);
  });

  it("delivers departure schedules and survives Rivian refusing them", async () => {
    manager = createManager();
    const received: unknown[][] = [];
    manager.subscribe("VIN1", () => {});
    manager.subscribeDepartureSchedules("VIN1", (_id, list) => received.push(list));
    manager.start();
    await server.until(() => server.conns[0] !== undefined && server.subscribes(server.conns[0]).length === 2);
    const conn = server.conns[0]!;
    conn.socket.send(
      JSON.stringify({
        id: "departureSchedules:VIN1",
        type: "next",
        payload: { data: { vehicleDepartureSchedules: [{ id: "d1", name: "Work", isEnabled: true }] } },
      }),
    );
    await server.until(() => received.length === 1);
    expect(received[0]).toEqual([
      { id: "d1", name: "Work", enabled: true, occurrence: null, comfortSettings: null },
    ]);

    conn.socket.send(
      JSON.stringify({ id: "departureSchedules:VIN1", type: "error", payload: [{ message: "nope" }] }),
    );
    await new Promise((r) => setTimeout(r, 150));
    expect(server.conns).toHaveLength(1);
    expect(manager.isUnsupported("departureSchedules")).toBe(true);
  });

  it("keeps the socket when only the charging subscription is refused", async () => {
    manager = createManager();
    manager.subscribe("VIN1", () => {});
    manager.subscribeCharging("VIN1", () => {});
    manager.start();
    await server.until(() => server.conns[0] !== undefined && server.subscribes(server.conns[0]).length === 2);
    server.conns[0]!.socket.send(
      JSON.stringify({
        id: "chargingSession:VIN1",
        type: "error",
        payload: [{ message: "unsupported" }],
      }),
    );
    await new Promise((r) => setTimeout(r, 200));
    expect(server.conns).toHaveLength(1);
    expect(manager.isConnected).toBe(true);
  });
});

describe("rejectedFields", () => {
  it("only returns known subscription fields", () => {
    expect(
      rejectedFields([
        { message: 'Cannot query field "seatRearLeftHeat" on type "VehicleState".' },
        { message: 'Cannot query field "somethingElse" on type "VehicleState".' },
        { message: "unrelated" },
      ]),
    ).toEqual(["seatRearLeftHeat"]);
  });
});
