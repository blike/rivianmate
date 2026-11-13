import { afterEach, describe, expect, it, vi } from 'vitest';
import { RivianClient, orderDates } from './client.js';
import { RivianGovernor } from './governor.js';
import { RivianCooldownError, RivianRateLimitError, RivianUnauthenticatedError } from './types.js';

type Handler = (op: string, headers: Record<string, string>) => Response;

function stubFetch(handler: Handler) {
  const calls: { op: string; headers: Record<string, string> }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const op = (JSON.parse(init.body as string) as { operationName: string }).operationName;
      const headers = init.headers as Record<string, string>;
      calls.push({ op, headers });
      return handler(op, headers);
    }),
  );
  return calls;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

let csrfCounter = 0;
const csrf = () =>
  json({
    data: {
      createCsrfToken: {
        csrfToken: `csrf-${++csrfCounter}`,
        appSessionToken: `asess-${csrfCounter}`,
      },
    },
  });

const tokens = { accessToken: 'access', refreshToken: 'refresh', userSessionToken: 'usess' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RivianClient', () => {
  it('restores session authentication without sending the stored access token as Bearer', async () => {
    const calls = stubFetch((op) =>
      op === 'CreateCSRFToken'
        ? csrf()
        : json({ data: { currentUser: { id: 'u', vehicles: [] } } }),
    );
    const client = new RivianClient({ tokens, governor: new RivianGovernor({ minSpacingMs: 0 }) });
    await client.getUserInfo();
    const headers = calls.find((c) => c.op === 'getUserInfo')!.headers;
    expect(headers['U-Sess']).toBe('usess');
    expect(headers['A-Sess']).toMatch(/^asess-/);
    expect(headers['Csrf-Token']).toMatch(/^csrf-/);
    expect(headers).not.toHaveProperty('Authorization');
  });

  it('rotates the session once on UNAUTHENTICATED and retries', async () => {
    let userInfoCalls = 0;
    const calls = stubFetch((op) => {
      if (op === 'CreateCSRFToken') return csrf();
      userInfoCalls += 1;
      return userInfoCalls === 1
        ? json({ errors: [{ message: 'expired', extensions: { code: 'UNAUTHENTICATED' } }] })
        : json({ data: { currentUser: { id: 'u', vehicles: [] } } });
    });
    const client = new RivianClient({ tokens, governor: new RivianGovernor({ minSpacingMs: 0 }) });
    await expect(client.getUserInfo()).resolves.toEqual({ id: 'u', vehicles: [] });
    expect(calls.filter((c) => c.op === 'CreateCSRFToken')).toHaveLength(2);
  });

  it('gives up after one rotation if still unauthenticated', async () => {
    stubFetch((op) =>
      op === 'CreateCSRFToken'
        ? csrf()
        : json({ errors: [{ message: 'no', extensions: { code: 'UNAUTHENTICATED' } }] }),
    );
    const client = new RivianClient({ tokens, governor: new RivianGovernor({ minSpacingMs: 0 }) });
    await expect(client.getUserInfo()).rejects.toBeInstanceOf(RivianUnauthenticatedError);
  });

  it('treats HTTP 429 as a rate limit and starts a cooldown', async () => {
    stubFetch((op) =>
      op === 'CreateCSRFToken' ? csrf() : json({}, 429, { 'retry-after': '1800' }),
    );
    const governor = new RivianGovernor({ minSpacingMs: 0 });
    const client = new RivianClient({ tokens, governor });
    const err = await client.getUserInfo().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RivianRateLimitError);
    expect((err as RivianRateLimitError).retryAfterMs).toBe(1_800_000);
    expect(governor.cooldownRemainingMs()).toBeGreaterThan(1_700_000);
    expect(governor.snapshot().last24h.rateLimited).toBe(1);
  });

  it('does not contact Rivian or extend the cooldown while paused', async () => {
    const calls = stubFetch((op) => (op === 'CreateCSRFToken' ? csrf() : json({}, 429)));
    const governor = new RivianGovernor({ minSpacingMs: 0 });
    const client = new RivianClient({ tokens, governor });
    await client.getUserInfo().catch(() => {});
    const sent = calls.length;
    const until = governor.snapshot().cooldownUntil;
    await expect(client.getUserInfo()).rejects.toBeInstanceOf(RivianCooldownError);
    expect(calls).toHaveLength(sent);
    expect(governor.snapshot().cooldownUntil).toBe(until);
    expect(governor.snapshot().last24h.rateLimited).toBe(1);
  });

  it('shares one rotation between concurrent callers', async () => {
    const calls = stubFetch(() => csrf());
    const client = new RivianClient({ tokens, governor: new RivianGovernor({ minSpacingMs: 0 }) });
    await Promise.all([client.refreshSession(), client.refreshSession()]);
    expect(calls).toHaveLength(1);
  });

  const newClient = () =>
    new RivianClient({ tokens, governor: new RivianGovernor({ minSpacingMs: 0 }) });

  describe('getOrderSnapshots', () => {
    const orderSnapshotsData = {
      data: {
        user: {
          orderSnapshots: [
            {
              id: 1000000001,
              state: 'ORDERED',
              configurationStatus: 'SOFT_LOCKED',
              fulfillmentSummaryStatus: 'PENDING_FULFILLMENT',
              vehicleId: '01-000000001',
              vin: null,
            },
          ],
        },
      },
    };

    it('asks the orders service, with the session', async () => {
      const calls = stubFetch((op) =>
        op === 'CreateCSRFToken' ? csrf() : json(orderSnapshotsData),
      );
      await expect(newClient().getOrderSnapshots()).resolves.toEqual([
        {
          id: '1000000001',
          state: 'ORDERED',
          configurationStatus: 'SOFT_LOCKED',
          fulfillmentSummaryStatus: 'PENDING_FULFILLMENT',
          vehicleId: '01-000000001',
          vin: null,
        },
      ]);
      const urls = vi.mocked(fetch).mock.calls.map(([url]) => url);
      expect(urls.at(-1)).toBe('https://rivian.com/api/gql/orders/graphql/');
      expect(calls.at(-1)!.headers['U-Sess']).toBe('usess');
      expect(calls.at(-1)!.headers['Csrf-Token']).toMatch(/^csrf-/);
    });

    it('reads a missing user as no orders', async () => {
      stubFetch((op) => (op === 'CreateCSRFToken' ? csrf() : json({ data: { user: null } })));
      await expect(newClient().getOrderSnapshots()).resolves.toEqual([]);
    });

    it('rotates the session once when the CSRF token has expired', async () => {
      let orderCalls = 0;
      const calls = stubFetch((op) => {
        if (op === 'CreateCSRFToken') return csrf();
        orderCalls += 1;
        return orderCalls === 1
          ? json({
              data: null,
              errors: [
                { message: 'Request a new CSRF token', extensions: { code: 'CSRF_TOKEN_EXPIRED' } },
              ],
            })
          : json(orderSnapshotsData);
      });
      await expect(newClient().getOrderSnapshots()).resolves.toHaveLength(1);
      expect(calls.filter((c) => c.op === 'CreateCSRFToken')).toHaveLength(2);
    });

    it("doesn't rotate the shared session on other auth errors", async () => {
      const calls = stubFetch((op) =>
        op === 'CreateCSRFToken'
          ? csrf()
          : json({ errors: [{ message: 'no', extensions: { code: 'UNAUTHENTICATED' } }] }),
      );
      await expect(newClient().getOrderSnapshots()).rejects.toBeInstanceOf(
        RivianUnauthenticatedError,
      );
      expect(calls.filter((c) => c.op === 'CreateCSRFToken')).toHaveLength(1);
      expect(calls.filter((c) => c.op === 'getOrderSnapshots')).toHaveLength(1);
    });
  });

  describe('getOrder', () => {
    it('reads the build record, options and the earliest delivery window', async () => {
      stubFetch((op) =>
        op === 'CreateCSRFToken'
          ? csrf()
          : json({
              data: {
                order: {
                  id: 1000000001,
                  type: 'VEHICLE',
                  state: 'ORDERED',
                  orderDate: '2026-11-20T09:30:00',
                  vin: null,
                  vehicleId: '01-000000001',
                  configurationStatus: 'SOFT_LOCKED',
                  fulfillmentSummaryStatus: 'PENDING_FULFILLMENT',
                  vehicle: {
                    vehicleId: '01-000000001',
                    vin: '7PD2EAAB4VN000001',
                    modelYear: 2027,
                    model: 'R2',
                    make: 'Rivian',
                    plannedBuildDate: '2027-01-15',
                    expectedBuildDate: '2026-12-20',
                    actualGeneralAssemblyDate: '2027-01-12',
                    expectedGeneralAssemblyStartDate: '2027-01-15',
                    status: 'VEHICLE_PREPPED',
                  },
                  payments: [
                    {
                      id: 'pay-2',
                      amount: '58302.90',
                      status: 'PROCESSING',
                      method: 'ACH',
                      type: 'BALANCE',
                      intent: 'PURCHASE',
                      date: '2027-01-28T09:14:00',
                    },
                    {
                      id: 'pay-1',
                      amount: 500,
                      status: 'SUCCEEDED',
                      method: 'CARD',
                      type: 'DEPOSIT',
                      intent: 'DEPOSIT',
                      date: '2026-11-20T09:35:00',
                    },
                  ],
                  items: [
                    {
                      title: 'Rivian R2',
                      type: 'VEHICLE',
                      configuration: {
                        options: [{ optionId: 'P1', optionName: 'Launch Green', groupId: 'PAINT' }],
                      },
                    },
                  ],
                  fulfillmentInfo: {
                    fulfillments: [
                      { estimatedDeliveryWindow: null },
                      {
                        estimatedDeliveryWindow: { startDate: '2027-02-10', endDate: '2027-02-20' },
                      },
                      {
                        estimatedDeliveryWindow: { startDate: '2027-02-01', endDate: '2027-02-05' },
                      },
                    ],
                  },
                },
              },
            }),
      );
      const order = await newClient().getOrder('1000000001');
      expect(order).toMatchObject({
        id: '1000000001',
        type: 'VEHICLE',
        vehicle: { vin: '7PD2EAAB4VN000001', modelYear: '2027', status: 'VEHICLE_PREPPED' },
        items: [
          {
            title: 'Rivian R2',
            options: [{ group: 'PAINT', id: 'P1', name: 'Launch Green' }],
          },
        ],
        payments: [
          { id: 'pay-1', amount: 500, status: 'SUCCEEDED', method: 'CARD', intent: 'DEPOSIT' },
          { id: 'pay-2', amount: 58302.9, status: 'PROCESSING', method: 'ACH', intent: 'PURCHASE' },
        ],
        // The deposit was paid minutes after ordering: no reservation came first.
        reservedDate: null,
        orderedDate: '2026-11-20T09:30:00',
        estimatedDelivery: { start: '2027-02-01', end: '2027-02-05' },
      });
      const urls = vi.mocked(fetch).mock.calls.map(([url]) => url);
      expect(urls.at(-1)).toBe('https://rivian.com/api/gql/orders/graphql/');
    });

    it('reads a missing order as null', async () => {
      stubFetch((op) => (op === 'CreateCSRFToken' ? csrf() : json({ data: { order: null } })));
      await expect(newClient().getOrder('nope')).resolves.toBeNull();
    });
  });

  describe('getDelivery', () => {
    it('reads the appointment from the gateway, with the session headers', async () => {
      const calls = stubFetch((op) =>
        op === 'CreateCSRFToken'
          ? csrf()
          : json({
              data: {
                delivery: {
                  status: 'DELIVERY_ACCEPTED',
                  carrier: 'THIRD_PARTY',
                  vehicleVIN: '7PD2EAAB4VN000001',
                  appointmentDetails: {
                    appointmentId: 'appt-1',
                    startDateTime: '2027-02-06T10:30:00',
                    endDateTime: '2027-02-06T10:45:00',
                    timeZone: 'America/Indiana/Indianapolis',
                  },
                  deliveryAddress: null,
                },
              },
            }),
      );
      await expect(newClient().getDelivery('1000000001')).resolves.toEqual({
        status: 'DELIVERY_ACCEPTED',
        carrier: 'THIRD_PARTY',
        vin: '7PD2EAAB4VN000001',
        appointment: {
          id: 'appt-1',
          start: '2027-02-06T10:30:00',
          end: '2027-02-06T10:45:00',
          timeZone: 'America/Indiana/Indianapolis',
        },
        address: null,
      });
      const urls = vi.mocked(fetch).mock.calls.map(([url]) => url);
      expect(urls.at(-1)).toBe('https://rivian.com/api/gql/gateway/graphql');
      expect(calls.at(-1)!.headers['U-Sess']).toBe('usess');
      expect(calls.at(-1)!.headers).not.toHaveProperty('Authorization');
    });

    it("doesn't rotate the shared session when the resolver refuses it", async () => {
      const calls = stubFetch((op) =>
        op === 'CreateCSRFToken'
          ? csrf()
          : json({ errors: [{ message: 'no', extensions: { code: 'UNAUTHENTICATED' } }] }),
      );
      await expect(newClient().getDelivery('1')).rejects.toBeInstanceOf(RivianUnauthenticatedError);
      expect(calls.filter((c) => c.op === 'CreateCSRFToken')).toHaveLength(1);
    });
  });

  describe('getOrderImageUrls', () => {
    it('keeps the best render of each view, by order', async () => {
      const image = (orderId: string | null, placement: string, design: string) => ({
        orderId,
        url: `https://render/${orderId}/${placement}/${design}.png`,
        resolution: '@2x',
        size: 'large',
        design,
        placement,
      });
      stubFetch((op) =>
        op === 'CreateCSRFToken'
          ? csrf()
          : json({
              data: {
                getVehicleOrderMobileImages: [
                  image('o1', 'three-quarter', 'light'),
                  image('o1', 'three-quarter', 'dark'),
                  image('o1', 'side', 'dark'),
                  image(null, 'overhead', 'dark'),
                ],
              },
            }),
      );
      await expect(newClient().getOrderImageUrls()).resolves.toEqual({
        o1: { 'three-quarter': 'https://render/o1/three-quarter/dark.png' },
      });
    });
  });
});

describe('orderDates', () => {
  const deposit = (date: string, status = 'SUCCEEDED') => ({
    id: 'p',
    amount: 100,
    status,
    method: 'CARD',
    type: 'DEPOSIT',
    intent: 'DEPOSIT',
    date,
  });

  it('dates a reservation by its own order date, not yet ordered', () => {
    expect(
      orderDates('PRE_ORDER', '2025-03-07T12:00:00Z', [deposit('2025-03-07T12:01:00')]),
    ).toEqual({ reservedDate: '2025-03-07T12:00:00Z', orderedDate: null });
  });

  it('dates a reservation by a deposit paid well before the order', () => {
    expect(orderDates('VEHICLE', '2026-04-02T15:20:11Z', [deposit('2025-03-07T12:01:00')])).toEqual(
      { reservedDate: '2025-03-07T12:01:00', orderedDate: '2026-04-02T15:20:11Z' },
    );
  });

  it('finds no reservation behind an order paid for when placed, or a cancelled deposit', () => {
    expect(orderDates('VEHICLE', '2026-04-02T15:20:11Z', [deposit('2026-04-02T10:21:00')])).toEqual(
      { reservedDate: null, orderedDate: '2026-04-02T15:20:11Z' },
    );
    expect(
      orderDates('VEHICLE', '2026-04-02T15:20:11Z', [deposit('2025-03-07T12:01:00', 'CANCELED')]),
    ).toEqual({ reservedDate: null, orderedDate: '2026-04-02T15:20:11Z' });
  });
});
