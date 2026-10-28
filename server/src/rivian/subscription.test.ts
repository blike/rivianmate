import type { IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import type { Logger } from '../logger.js';
import { RivianGovernor } from './governor.js';
import {
  CLOSE_CONNECTION_TTL_EXPIRED,
  RivianSubscriptionManager,
  rejectedFields,
} from './subscription.js';
import type { LiveSessionData, VehicleState } from './types.js';

interface Received {
  type: string;
  id?: string;
  payload?: { query?: string; operationName?: string; variables?: Record<string, unknown> };
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
    this.wss.on('connection', (socket, req) => {
      const conn: ServerConn = { socket, headers: req.headers, messages: [] };
      this.conns.push(conn);
      socket.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as Received;
        conn.messages.push(msg);
        if (msg.type === 'connection_init') {
          socket.send(JSON.stringify({ type: 'connection_ack' }));
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
      if (Date.now() > deadline) throw new Error('timed out waiting');
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, 25);
      });
    }
  }

  subscribes(conn: ServerConn): Received[] {
    return conn.messages.filter((m) => m.type === 'subscribe');
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

describe('RivianSubscriptionManager', () => {
  let server: FakeRivian;
  let manager: RivianSubscriptionManager;

  beforeEach(() => {
    server = new FakeRivian();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    manager?.stop();
    await server.close();
  });

  function createManager(
    overrides: {
      initialBackoffMs?: number;
      heartbeatIntervalMs?: number;
      governor?: RivianGovernor;
      log?: Logger;
    } = {},
  ) {
    return new RivianSubscriptionManager({
      url: server.url,
      governor: overrides.governor ?? new RivianGovernor({ minSpacingMs: 0 }),
      getCredentials: () => ({
        userSessionToken: 'usess',
        appSession: { appSessionToken: 'asess', csrfToken: 'csrf' },
      }),
      initialBackoffMs: overrides.initialBackoffMs ?? 50,
      ttlRenewDelayMs: 10,
      heartbeatIntervalMs: overrides.heartbeatIntervalMs,
      log: overrides.log,
    });
  }

  it('distinguishes feed delivery, idle, errors, unsupported and reconnect waiting', async () => {
    manager = createManager();
    manager.subscribe('VIN1', () => {});
    manager.subscribeCharging('VIN1', () => {});
    manager.subscribeParallax('VIN1', ['battery'], () => {});
    const feed = (kind: string) => manager.diagnostics().feeds.find((f) => f.kind === kind)!;
    expect(manager.diagnostics().state).toBe('stopped');
    expect(feed('vehicleState').lastMessageAt).toBeNull();
    manager.start();
    await server.until(
      () => server.conns[0] !== undefined && server.subscribes(server.conns[0]).length === 3,
    );
    const conn = server.conns[0]!;
    expect(manager.diagnostics().state).toBe('connected');
    expect(manager.diagnostics().lastMessageAt).not.toBeNull(); // ack, not feed data
    expect(feed('vehicleState').status).toBe('waiting');
    conn.socket.send(
      JSON.stringify({
        type: 'next',
        id: 'chargingSession:VIN1',
        payload: { data: { chargingSession: { liveData: { powerKW: { value: 7.2 } } } } },
      }),
    );
    conn.socket.send(
      JSON.stringify({
        type: 'next',
        id: 'vehicleState:VIN1',
        payload: { data: { vehicleState: { batteryLevel: { value: 80, timeStamp: 't' } } } },
      }),
    );
    await server.until(
      () =>
        feed('vehicleState').status === 'receiving' &&
        feed('chargingSession').status === 'receiving',
    );
    const lastData = feed('vehicleState').lastMessageAt;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(lastData!) + 5 * 60_000);
    expect(feed('vehicleState').status).toBe('waiting');
    clock.mockRestore();
    conn.socket.send(
      JSON.stringify({
        type: 'next',
        id: 'vehicleState:VIN1',
        payload: { errors: [{ message: 'temporary error' }] },
      }),
    );
    await server.until(() => feed('vehicleState').status === 'errored');
    expect(feed('vehicleState').lastMessageAt).toBe(lastData);
    conn.socket.send(
      JSON.stringify({
        type: 'error',
        id: 'parallax:VIN1',
        payload: [{ message: 'unsupported' }],
      }),
    );
    await server.until(() => feed('parallax').status === 'unsupported');
    conn.socket.close(CLOSE_CONNECTION_TTL_EXPIRED, 'renew');
    await server.until(
      () => server.conns[1] !== undefined && server.subscribes(server.conns[1]).length === 2,
    );
    expect(feed('vehicleState').status).toBe('waiting');
    expect(feed('vehicleState').lastMessageAt).toBe(lastData);
    expect(feed('parallax').status).toBe('unsupported');
    server.conns[1]!.socket.send(
      JSON.stringify({
        type: 'next',
        id: 'vehicleState:VIN1',
        payload: { data: { vehicleState: {} } },
      }),
    );
    await server.until(() => feed('vehicleState').status === 'receiving');
    manager.stop();
    expect(manager.diagnostics().state).toBe('stopped');
    expect(feed('vehicleState').status).toBe('waiting');
  });

  it('shows a legacy feed that only ever sends nulls (an R2) as having no data', async () => {
    manager = createManager();
    manager.subscribe('VIN1', () => {});
    manager.subscribeCharging('VIN1', () => {});
    const feed = (kind: string) => manager.diagnostics().feeds.find((f) => f.kind === kind)!;
    manager.start();
    await server.until(
      () => server.conns[0] !== undefined && server.subscribes(server.conns[0]).length === 2,
    );
    const send = (id: string, data: unknown) =>
      server.conns[0]!.socket.send(JSON.stringify({ type: 'next', id, payload: { data } }));
    // As pasted from an R2: the connection status, and every field null.
    send('vehicleState:VIN1', {
      vehicleState: {
        cloudConnection: { lastSync: '2026-10-13T06:21:38.778Z', isOnline: true },
        batteryLevel: null,
        gnssLocation: null,
      },
    });
    send('chargingSession:VIN1', {
      chargingSession: { chartData: [], liveData: { powerKW: null, startTime: null } },
    });
    await server.until(
      () => feed('vehicleState').status === 'empty' && feed('chargingSession').status === 'empty',
    );
    send('vehicleState:VIN1', { vehicleState: { batteryLevel: { value: 80, timeStamp: 't' } } });
    await server.until(() => feed('vehicleState').status === 'receiving');
    expect(feed('chargingSession').status).toBe('empty');
  });

  it('tracks Parallax domains independently, including empty cleared payloads', async () => {
    manager = createManager();
    manager.subscribeParallax(
      'v1',
      [
        'charging.session.status',
        'energy.high_voltage.battery_state',
        'energy_edge_compute.graphs.parked_energy_distributions',
        'navigation.navigation_service.trip_info',
      ],
      () => {},
    );
    manager.start();
    await server.until(
      () => server.conns[0] !== undefined && server.subscribes(server.conns[0]).length === 1,
    );
    const feed = (domain: string) => manager.diagnostics().feeds.find((f) => f.domain === domain)!;
    expect(manager.diagnostics().feeds).toHaveLength(3);
    expect(feed('energy').topics).toHaveLength(2);
    const conn = server.conns[0]!;
    const send = (rvm: string) =>
      conn.socket.send(
        JSON.stringify({
          type: 'next',
          id: 'parallax:v1',
          payload: { data: { parallaxMessages: { rvm, payload: '' } } },
        }),
      );
    send('charging.session.status');
    await server.until(() => feed('charging').status === 'receiving');
    expect(feed('energy').status).toBe('waiting');
    expect(feed('navigation').lastMessageAt).toBeNull();
    send('navigation.navigation_service.trip_info');
    await server.until(() => feed('navigation').status === 'receiving');
    expect(feed('energy').lastMessageAt).toBeNull();
    conn.socket.close(CLOSE_CONNECTION_TTL_EXPIRED, 'renew');
    await server.until(
      () => server.conns[1] !== undefined && server.subscribes(server.conns[1]).length === 1,
    );
    expect(feed('charging').status).toBe('waiting');
    expect(feed('navigation').status).toBe('waiting');
  });

  it('subscribes to every topic, passing on and keeping only those in the registry', async () => {
    const log = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    manager = createManager({ log: log as unknown as Logger });
    const received: string[] = [];
    manager.subscribeParallax('v1', null, (_id, message) => received.push(message.rvm));
    manager.start();
    await server.until(
      () => server.conns[0] !== undefined && server.subscribes(server.conns[0]).length === 1,
    );
    expect(server.subscribes(server.conns[0]!)[0]!.payload!.variables).toEqual({ vehicleId: 'v1' });
    const feed = (domain: string) => manager.diagnostics().feeds.find((f) => f.domain === domain);
    // Every registry topic shows before any arrives, by its kind.
    expect(feed('dynamics')!.topics).toContainEqual({ rvm: 'dynamics.vehicle.gear', kind: 'read' });
    expect(feed('security')!.topics).toContainEqual({
      rvm: 'security.alarm.state',
      kind: 'probe',
    });
    expect(feed('device_table')).toBeUndefined();

    const send = (rvm: string, payload: string) =>
      server.conns[0]!.socket.send(
        JSON.stringify({
          type: 'next',
          id: 'parallax:v1',
          payload: { data: { parallaxMessages: { rvm, payload } } },
        }),
      );
    const secret = Buffer.from('a phone key').toString('base64');
    send('device_table.vas_keyper.devices', secret);
    send('device_table.vas_keyper.devices', secret);
    send('security.access.passive_entry', 'CAE=');
    send('dynamics.vehicle.gear', 'CAE=');
    await server.until(() => received.length === 1 && feed('dynamics')!.status === 'receiving');

    expect(received).toEqual(['dynamics.vehicle.gear']);
    expect(feed('device_table')).toMatchObject({
      topics: [{ rvm: 'device_table.vas_keyper.devices', kind: 'unregistered' }],
      status: 'receiving',
    });
    // An unregistered topic doesn't make a domain of registry topics look well.
    expect(feed('security')!.topics).toContainEqual({
      rvm: 'security.access.passive_entry',
      kind: 'unregistered',
    });
    expect(feed('security')!.status).toBe('waiting');
    expect(manager.latestData('parallax:v1:device_table')!.messages).toEqual([
      {
        topic: 'device_table.vas_keyper.devices',
        receivedAt: expect.any(String),
        count: 2,
        bytes: 11,
      },
    ]);
    expect(manager.latestData('parallax:v1:dynamics')!.messages[0]!.fields).toBeDefined();
    // The payload is kept nowhere, and the topic is logged once.
    expect(JSON.stringify(manager.diagnostics())).not.toContain(secret);
    expect(JSON.stringify(manager.latestData('parallax:v1:device_table'))).not.toContain(secret);
    const logged = log.info.mock.calls.filter(([line]) =>
      String(line).includes('device_table.vas_keyper.devices'),
    );
    expect(logged).toHaveLength(1);
  });

  it('subscribes to the named topics only, when given them', async () => {
    manager = createManager();
    manager.subscribeParallax('v1', ['charging.session.status'], () => {});
    manager.start();
    await server.until(
      () => server.conns[0] !== undefined && server.subscribes(server.conns[0]).length === 1,
    );
    expect(server.subscribes(server.conns[0]!)[0]!.payload!.variables).toEqual({
      vehicleId: 'v1',
      rvms: ['charging.session.status'],
    });
    expect(manager.diagnostics().feeds.map((f) => f.domain)).toEqual(['charging']);
  });

  it('sends session headers and subscribes once per vehicle and kind', async () => {
    manager = createManager();
    const states: VehicleState[] = [];
    const sessions: (LiveSessionData | null)[] = [];
    manager.subscribe('VIN1', (_vin, s) => states.push(s));
    manager.subscribeCharging('VIN1', (_vin, s) => sessions.push(s));
    manager.start();

    await server.until(
      () => server.conns[0] !== undefined && server.subscribes(server.conns[0]).length === 2,
    );
    const conn = server.conns[0]!;
    expect(conn.headers['u-sess']).toBe('usess');
    expect(conn.headers['a-sess']).toBe('asess');
    expect(conn.headers['csrf-token']).toBe('csrf');
    expect(conn.headers['sec-websocket-protocol']).toBe('graphql-transport-ws');
    expect(
      server
        .subscribes(conn)
        .map((m) => m.id)
        .sort(),
    ).toEqual(['chargingSession:VIN1', 'vehicleState:VIN1']);

    // Re-registering a callback must not produce a duplicate subscribe.
    manager.subscribe('VIN1', (_vin, s) => states.push(s));
    conn.socket.send(
      JSON.stringify({
        id: 'vehicleState:VIN1',
        type: 'next',
        payload: { data: { vehicleState: { batteryLevel: { timeStamp: 't', value: 80 } } } },
      }),
    );
    conn.socket.send(
      JSON.stringify({
        id: 'chargingSession:VIN1',
        type: 'next',
        payload: { data: { chargingSession: { liveData: { powerKW: 11 }, chartData: [] } } },
      }),
    );
    await server.until(() => states.length === 1 && sessions.length === 1);
    expect(server.subscribes(conn)).toHaveLength(2);
    expect(states[0]!.batteryLevel).toEqual({ timeStamp: 't', value: 80 });
    expect(sessions[0]!.power?.value).toBe(11);
  });

  it('answers protocol pings with pongs', async () => {
    manager = createManager();
    manager.subscribe('VIN1', () => {});
    manager.start();
    await server.until(
      () => server.conns[0] !== undefined && server.subscribes(server.conns[0]).length === 1,
    );
    const conn = server.conns[0]!;
    conn.socket.send(JSON.stringify({ type: 'ping' }));
    await server.until(() => conn.messages.some((m) => m.type === 'pong'));
  });

  it("renews quickly after Rivian's connection TTL close", async () => {
    // A large backoff proves the TTL path doesn't use it.
    manager = createManager({ initialBackoffMs: 60_000 });
    manager.subscribe('VIN1', () => {});
    manager.start();
    await server.until(
      () => server.conns[0] !== undefined && server.subscribes(server.conns[0]).length === 1,
    );
    server.conns[0]!.socket.close(CLOSE_CONNECTION_TTL_EXPIRED, 'Connection TTL expired');
    await server.until(
      () => server.conns[1] !== undefined && server.subscribes(server.conns[1]).length === 1,
    );
    expect(server.subscribes(server.conns[1]!)[0]!.id).toBe('vehicleState:VIN1');
  });

  it("logs connecting at info, but Rivian's scheduled renewals only at debug", async () => {
    const log = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    manager = createManager({ log: log as unknown as Logger });
    manager.subscribe('VIN1', () => {});
    manager.start();
    const subscribed = (i: number) => () =>
      server.conns[i] !== undefined && server.subscribes(server.conns[i]).length === 1;
    await server.until(subscribed(0));
    expect(log.info).toHaveBeenCalledWith('connected');
    log.info.mockClear();
    server.conns[0]!.socket.close(CLOSE_CONNECTION_TTL_EXPIRED, 'Connection TTL expired');
    await server.until(subscribed(1));
    expect(log.debug).toHaveBeenCalledWith('connected');
    expect(log.info).not.toHaveBeenCalled();
  });

  it("counts lost connections as drops, but not Rivian's scheduled renewals", async () => {
    const governor = new RivianGovernor({ minSpacingMs: 0 });
    manager = createManager({ governor });
    manager.subscribe('VIN1', () => {});
    manager.start();
    const subscribed = (i: number) => () =>
      server.conns[i] !== undefined && server.subscribes(server.conns[i]).length === 1;
    await server.until(subscribed(0));
    server.conns[0]!.socket.close(CLOSE_CONNECTION_TTL_EXPIRED, 'Connection TTL expired');
    await server.until(subscribed(1));
    expect(governor.snapshot().last24h.wsDrops).toBe(0);
    server.conns[1]!.socket.terminate(); // closes without a frame (1006)
    await server.until(subscribed(2));
    expect(governor.snapshot().last24h.wsDrops).toBe(1);
  });

  it("keeps each feed's latest data, naming the Parallax fields it reads", async () => {
    manager = createManager();
    manager.subscribe('VIN1', () => {});
    manager.subscribeParallax(
      'VIN1',
      ['charging.session.soc_slider', 'charging.session.notification'],
      () => {},
    );
    manager.start();
    await server.until(
      () => server.conns[0] !== undefined && server.subscribes(server.conns[0]).length === 2,
    );
    const send = (id: string, data: unknown) =>
      server.conns[0]!.socket.send(JSON.stringify({ type: 'next', id, payload: { data } }));
    const stamped = (value: unknown) => ({ value, timeStamp: '2026-10-11T17:00:00Z' });
    send('vehicleState:VIN1', { vehicleState: { batteryLevel: stamped(62) } });
    send('vehicleState:VIN1', { vehicleState: { gearStatus: stamped('drive') } });
    const parallax = (rvm: string, payload: string) =>
      send('parallax:VIN1', { parallaxMessages: { rvm, payload } });
    parallax('charging.session.soc_slider', Buffer.from([0x08, 80]).toString('base64'));
    parallax('charging.session.notification', Buffer.from([0x08, 5]).toString('base64'));
    await server.until(() => manager.latestData('parallax:VIN1:charging')?.messages.length === 2);

    // Vehicle state arrives as changes; every field's latest value is kept.
    expect(manager.latestData('vehicleState:VIN1')!.messages[0]!.data).toEqual({
      batteryLevel: stamped(62),
      gearStatus: stamped('drive'),
    });
    const charging = manager.latestData('parallax:VIN1:charging')!.messages;
    expect(charging.map(({ topic, fields }) => ({ topic, fields }))).toEqual([
      {
        topic: 'charging.session.soc_slider',
        fields: [{ path: '1', name: 'Charge limit (%)', value: 80 }],
      },
      {
        topic: 'charging.session.notification',
        fields: [{ path: '1', name: 'Unexpected stop reason', value: 5 }],
      },
    ]);
    expect(manager.latestData('nothing')).toBeNull();
  });

  it('reports auth failures and keeps retrying with backoff', async () => {
    manager = createManager();
    let failures = 0;
    manager.onAuthFailure = () => {
      failures += 1;
    };
    manager.subscribe('VIN1', () => {});
    manager.start();
    await server.until(
      () => server.conns[0] !== undefined && server.subscribes(server.conns[0]).length === 1,
    );
    server.conns[0]!.socket.send(
      JSON.stringify({
        id: 'vehicleState:VIN1',
        type: 'error',
        payload: [{ message: 'nope', extensions: { code: 'UNAUTHENTICATED' } }],
      }),
    );
    await server.until(() => failures === 1 && server.conns.length === 2);
  });

  it('drops a field Rivian rejects and resubscribes without it', async () => {
    manager = createManager();
    manager.subscribe('VIN1', () => {});
    manager.start();
    await server.until(
      () => server.conns[0] !== undefined && server.subscribes(server.conns[0]).length === 1,
    );
    expect(server.subscribes(server.conns[0]!)[0]!.payload?.query).toContain('seatRearLeftHeat');
    server.conns[0]!.socket.send(
      JSON.stringify({
        id: 'vehicleState:VIN1',
        type: 'error',
        payload: [{ message: 'Cannot query field "seatRearLeftHeat" on type "VehicleState".' }],
      }),
    );
    await server.until(
      () => server.conns[1] !== undefined && server.subscribes(server.conns[1]).length === 1,
    );
    const query = server.subscribes(server.conns[1]!)[0]!.payload?.query ?? '';
    expect(query).not.toContain('seatRearLeftHeat');
    expect(query).toContain('batteryLevel');
    expect(manager.droppedFields).toEqual(['seatRearLeftHeat']);
    expect(manager.usingCoreFieldsOnly).toBe(false);
  });

  it('does not churn sockets when the server never answers pings', async () => {
    await server.close();
    server = new FakeRivian({ autoPong: false });
    manager = createManager({ heartbeatIntervalMs: 20 });
    manager.subscribe('VIN1', () => {});
    manager.start();
    await server.until(
      () => server.conns[0] !== undefined && server.subscribes(server.conns[0]).length === 1,
    );
    await new Promise((r) => setTimeout(r, 200));
    expect(server.conns).toHaveLength(1);
    expect(manager.isConnected).toBe(true);
  });

  it('drops a socket that stops answering pings after it has answered before', async () => {
    manager = createManager({ heartbeatIntervalMs: 30 });
    manager.subscribe('VIN1', () => {});
    manager.start();
    await server.until(
      () => server.conns[0] !== undefined && server.subscribes(server.conns[0]).length === 1,
    );
    await new Promise((r) => setTimeout(r, 100)); // at least one pong observed
    server.conns[0]!.socket.pause(); // stop reading: pings go unanswered
    await server.until(() => server.conns.length === 2, 3_000);
  });

  it('backs off when the subscription keeps ending without data', async () => {
    // Rivian accepts the handshake, then immediately completes the subscription.
    server.wss.on('connection', (socket) => {
      socket.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as Received;
        if (msg.type === 'subscribe') {
          socket.send(JSON.stringify({ id: msg.id, type: 'complete' }));
        }
      });
    });
    const connectedAt: number[] = [];
    server.wss.on('connection', () => connectedAt.push(Date.now()));
    manager = createManager({ initialBackoffMs: 60 });
    manager.subscribe('VIN1', () => {});
    manager.start();
    await server.until(() => connectedAt.length >= 4, 5_000);
    const gaps = connectedAt.slice(1).map((t, i) => t - connectedAt[i]!);
    // 60 → 120 → 240ms (+≤25% jitter): must grow, not reset on each ack.
    expect(gaps[2]!).toBeGreaterThan(gaps[0]! * 2);
  });

  it('falls back to core fields when the subscription ends silently', async () => {
    server.wss.on('connection', (socket) => {
      socket.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as Received;
        if (msg.type === 'subscribe' && server.conns.length === 1) {
          socket.send(JSON.stringify({ id: msg.id, type: 'complete' }));
        }
      });
    });
    manager = createManager();
    manager.subscribe('VIN1', () => {});
    manager.start();
    await server.until(
      () => server.conns[1] !== undefined && server.subscribes(server.conns[1]).length === 1,
    );
    const query = server.subscribes(server.conns[1]!)[0]!.payload?.query ?? '';
    expect(manager.usingCoreFieldsOnly).toBe(true);
    expect(query).toContain('batteryLevel');
    expect(query).toContain('gnssLocation');
    expect(query).not.toContain('seatRearLeftHeat');
  });

  it('resets the backoff once vehicle data arrives', async () => {
    let completes = 0;
    server.wss.on('connection', (socket) => {
      socket.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as Received;
        if (msg.type !== 'subscribe') return;
        if (completes < 3) {
          completes += 1;
          socket.send(JSON.stringify({ id: msg.id, type: 'complete' }));
        } else {
          socket.send(
            JSON.stringify({
              id: msg.id,
              type: 'next',
              payload: { data: { vehicleState: { batteryLevel: { timeStamp: 't', value: 1 } } } },
            }),
          );
          setTimeout(() => socket.close(4000, 'bye'), 20);
        }
      });
    });
    const connectedAt: number[] = [];
    server.wss.on('connection', () => connectedAt.push(Date.now()));
    manager = createManager({ initialBackoffMs: 60 });
    manager.subscribe('VIN1', () => {});
    manager.start();
    await server.until(() => connectedAt.length >= 5, 5_000);
    // Attempts 1-3 escalate (60,120,240); after data the next wait is ~60 again.
    const lastGap = connectedAt[4]! - connectedAt[3]!;
    expect(lastGap).toBeLessThan(200);
  });

  it('delivers departure schedules and survives Rivian refusing them', async () => {
    manager = createManager();
    const received: unknown[][] = [];
    manager.subscribe('VIN1', () => {});
    manager.subscribeDepartureSchedules('VIN1', (_id, list) => received.push(list));
    manager.start();
    await server.until(
      () => server.conns[0] !== undefined && server.subscribes(server.conns[0]).length === 2,
    );
    const conn = server.conns[0]!;
    conn.socket.send(
      JSON.stringify({
        id: 'departureSchedules:VIN1',
        type: 'next',
        payload: {
          data: { vehicleDepartureSchedules: [{ id: 'd1', name: 'Work', isEnabled: true }] },
        },
      }),
    );
    await server.until(() => received.length === 1);
    expect(received[0]).toEqual([
      { id: 'd1', name: 'Work', enabled: true, occurrence: null, comfortSettings: null },
    ]);

    conn.socket.send(
      JSON.stringify({
        id: 'departureSchedules:VIN1',
        type: 'error',
        payload: [{ message: 'nope' }],
      }),
    );
    await new Promise((r) => setTimeout(r, 150));
    expect(server.conns).toHaveLength(1);
    expect(manager.isUnsupported('departureSchedules')).toBe(true);
  });

  it('keeps the socket when Parallax is refused', async () => {
    manager = createManager();
    manager.subscribe('VIN1', () => {});
    manager.subscribeParallax('VIN1', null, () => {});
    manager.start();
    await server.until(
      () => server.conns[0] !== undefined && server.subscribes(server.conns[0]).length === 2,
    );
    server.conns[0]!.socket.send(
      JSON.stringify({
        id: 'parallax:VIN1',
        type: 'error',
        payload: [{ message: 'Cannot query field' }],
      }),
    );
    await new Promise((r) => setTimeout(r, 200));
    expect(manager.isUnsupported('parallax')).toBe(true);
    expect(server.conns).toHaveLength(1);
  });

  it("keeps other vehicles' Parallax when one vehicle refuses it", async () => {
    manager = createManager({ initialBackoffMs: 60_000 });
    for (const vin of ['VIN1', 'VIN2']) {
      manager.subscribe(vin, () => {});
      manager.subscribeParallax(vin, null, () => {});
    }
    manager.start();
    await server.until(
      () => server.conns[0] !== undefined && server.subscribes(server.conns[0]).length === 4,
    );
    server.conns[0]!.socket.send(
      JSON.stringify({
        id: 'parallax:VIN1',
        type: 'error',
        payload: [{ message: 'Cannot query field' }],
      }),
    );
    await server.until(() => manager.isUnsupported('parallax', 'VIN1'));
    expect(manager.isUnsupported('parallax', 'VIN2')).toBe(false);
    expect(server.conns).toHaveLength(1);

    // On the next connection only the refused subscription stays unsent.
    server.conns[0]!.socket.close(CLOSE_CONNECTION_TTL_EXPIRED, 'Connection TTL expired');
    await server.until(
      () => server.conns[1] !== undefined && server.subscribes(server.conns[1]).length === 3,
    );
    expect(server.subscribes(server.conns[1]!).map((m) => m.id)).not.toContain('parallax:VIN1');
    expect(server.subscribes(server.conns[1]!).map((m) => m.id)).toContain('parallax:VIN2');
  });

  it('keeps the socket when only the charging subscription is refused', async () => {
    manager = createManager();
    manager.subscribe('VIN1', () => {});
    manager.subscribeCharging('VIN1', () => {});
    manager.start();
    await server.until(
      () => server.conns[0] !== undefined && server.subscribes(server.conns[0]).length === 2,
    );
    server.conns[0]!.socket.send(
      JSON.stringify({
        id: 'chargingSession:VIN1',
        type: 'error',
        payload: [{ message: 'unsupported' }],
      }),
    );
    await new Promise((r) => setTimeout(r, 200));
    expect(server.conns).toHaveLength(1);
    expect(manager.isConnected).toBe(true);
  });
});

describe('rejectedFields', () => {
  it('only returns known subscription fields', () => {
    expect(
      rejectedFields([
        { message: 'Cannot query field "seatRearLeftHeat" on type "VehicleState".' },
        { message: 'Cannot query field "somethingElse" on type "VehicleState".' },
        { message: 'unrelated' },
      ]),
    ).toEqual(['seatRearLeftHeat']);
  });
});
