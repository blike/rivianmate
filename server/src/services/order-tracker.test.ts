import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RivianApi } from '../rivian/client.js';
import { RivianApiError } from '../rivian/types.js';
import { ORDER_REFRESH_MS, OrderTracker } from './order-tracker.js';

const snapshot = (id: string, vehicleId: string | null, state = 'ORDERED') => ({
  id,
  state,
  configurationStatus: 'SOFT_LOCKED',
  fulfillmentSummaryStatus: 'PENDING_FULFILLMENT',
  vehicleId,
  vin: null,
});
const vehicleOrder = (id: string, type = 'VEHICLE') => ({
  id,
  type,
  state: 'ORDERED',
  orderDate: null,
  configurationStatus: null,
  fulfillmentSummaryStatus: null,
  vehicle: null,
  items: [],
  estimatedDelivery: null,
});

function track(api: object, vehicleIds: string[] = [], onNewVehicle = vi.fn()) {
  const tracker = new OrderTracker(undefined, onNewVehicle);
  const start = () => tracker.start(api as RivianApi, vehicleIds, () => vehicleIds);
  return { tracker, start, onNewVehicle };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('OrderTracker', () => {
  it('puts orders on their way first, then delivered ones, keeping refusals as refusals', async () => {
    const api = {
      getOrderSnapshots: vi
        .fn()
        .mockResolvedValue([snapshot('o-delivered', 'v1'), snapshot('o-pending', null)]),
      getOrder: vi.fn(async (id: string) => vehicleOrder(id)),
      getDelivery: vi.fn(async (id: string) => {
        if (id === 'o-pending') {
          throw new RivianApiError('User is unauthenticated', 'INTERNAL_SERVER_ERROR');
        }
        return null;
      }),
      getOrderImageUrls: vi.fn().mockResolvedValue({
        'o-pending': { 'three-quarter': 'https://render/o-pending.png' },
      }),
    };
    const { tracker, start } = track(api, ['v1']);
    await start();
    expect(tracker.getJourneys()).toEqual([
      {
        snapshot: snapshot('o-pending', null),
        delivered: false,
        detail: { ok: true, value: vehicleOrder('o-pending') },
        delivery: { ok: false, error: 'INTERNAL_SERVER_ERROR: User is unauthenticated' },
        renders: { 'three-quarter': 'https://render/o-pending.png' },
      },
      {
        snapshot: snapshot('o-delivered', 'v1'),
        delivered: true,
        detail: { ok: true, value: vehicleOrder('o-delivered') },
        delivery: { ok: true, value: null },
        renders: {},
      },
    ]);
    expect(tracker.checked).toBeInstanceOf(Date);
    tracker.stop();
  });

  it('leaves out gear orders and cancelled ones', async () => {
    const api = {
      getOrderSnapshots: vi
        .fn()
        .mockResolvedValue([snapshot('o-gear', null), snapshot('o-cancelled', null, 'CANCELLED')]),
      getOrder: vi.fn(async (id: string) => vehicleOrder(id, 'RETAIL')),
      getDelivery: vi.fn(),
      getOrderImageUrls: vi.fn(),
    };
    const { tracker, start } = track(api);
    await start();
    expect(api.getOrder).toHaveBeenCalledExactlyOnceWith('o-gear');
    expect(api.getDelivery).not.toHaveBeenCalled();
    expect(api.getOrderImageUrls).not.toHaveBeenCalled();
    expect(tracker.getJourneys()).toEqual([]);
  });

  it('still asks for the delivery when the order detail failed', async () => {
    const api = {
      getOrderSnapshots: vi.fn().mockResolvedValue([snapshot('o1', null)]),
      getOrder: vi.fn().mockRejectedValue(new Error('timeout')),
      getDelivery: vi.fn().mockResolvedValue(null),
      getOrderImageUrls: vi.fn().mockResolvedValue({}),
    };
    const { tracker, start } = track(api);
    await start();
    expect(tracker.getJourneys()[0]).toMatchObject({
      detail: { ok: false, error: 'timeout' },
      delivery: { ok: true, value: null },
      renders: {},
    });
    tracker.stop();
  });

  it('reports a failed listing until one succeeds', async () => {
    const api = {
      getOrderSnapshots: vi.fn().mockRejectedValue(new Error('Non-JSON response (404)')),
    };
    const { tracker, start } = track(api);
    await start();
    expect(tracker.diagnostics()).toMatchObject({
      checkedAt: null,
      lastError: { message: 'Non-JSON response (404)' },
      orders: [],
    });
  });

  it('shows render views, never their tokenized URLs, in diagnostics', async () => {
    const api = {
      getOrderSnapshots: vi.fn().mockResolvedValue([snapshot('o1', null)]),
      getOrder: vi.fn(async (id: string) => vehicleOrder(id)),
      getDelivery: vi.fn().mockResolvedValue(null),
      getOrderImageUrls: vi.fn().mockResolvedValue({ o1: { overhead: 'https://render?token=x' } }),
    };
    const { tracker, start } = track(api);
    await start();
    const d = tracker.diagnostics();
    expect(d.journeys[0]!.renders).toEqual(['overhead']);
    expect(JSON.stringify(d)).not.toContain('token=x');
    expect(d.nextCheckAt).not.toBeNull();
    tracker.stop();
  });

  it('on a refresh, asks again only about orders on their way, and renders only once', async () => {
    vi.useFakeTimers();
    const api = {
      getUserInfo: vi.fn().mockResolvedValue({ id: 'u', vehicles: [{ id: 'v1' }] }),
      getOrderSnapshots: vi
        .fn()
        .mockResolvedValue([snapshot('o-delivered', 'v1'), snapshot('o-pending', null)]),
      getOrder: vi.fn(async (id: string) => vehicleOrder(id)),
      getDelivery: vi.fn().mockResolvedValue(null),
      getOrderImageUrls: vi.fn().mockResolvedValue({
        'o-pending': { overhead: 'https://render/p.png' },
        'o-delivered': { overhead: 'https://render/d.png' },
      }),
    };
    const { tracker, start } = track(api, ['v1']);
    await start();
    api.getOrder.mockClear();
    api.getOrderImageUrls.mockClear();
    await vi.advanceTimersByTimeAsync(ORDER_REFRESH_MS);
    expect(api.getOrder).toHaveBeenCalledExactlyOnceWith('o-pending');
    expect(api.getOrderImageUrls).not.toHaveBeenCalled();
    expect(tracker.getJourneys().map((j) => [j.snapshot.id, j.delivered])).toEqual([
      ['o-pending', false],
      ['o-delivered', true],
    ]);
    tracker.stop();
    await vi.advanceTimersByTimeAsync(ORDER_REFRESH_MS);
    expect(api.getOrderSnapshots).toHaveBeenCalledTimes(2);
  });

  it('hands over when a new vehicle reaches the account', async () => {
    vi.useFakeTimers();
    const api = {
      getUserInfo: vi.fn().mockResolvedValue({ id: 'u', vehicles: [{ id: 'v-new' }] }),
      getOrderSnapshots: vi.fn().mockResolvedValue([snapshot('o-pending', 'v-new')]),
      getOrder: vi.fn(async (id: string) => vehicleOrder(id)),
      getDelivery: vi.fn().mockResolvedValue(null),
      getOrderImageUrls: vi.fn().mockResolvedValue({}),
    };
    const { tracker, start, onNewVehicle } = track(api);
    await start();
    await vi.advanceTimersByTimeAsync(ORDER_REFRESH_MS);
    expect(onNewVehicle).toHaveBeenCalledOnce();
    expect(api.getOrderSnapshots).toHaveBeenCalledTimes(1);
    tracker.stop();
  });

  it("doesn't keep checking once every order is delivered", async () => {
    vi.useFakeTimers();
    const api = {
      getUserInfo: vi.fn(),
      getOrderSnapshots: vi.fn().mockResolvedValue([snapshot('o1', 'v1')]),
      getOrder: vi.fn(async (id: string) => vehicleOrder(id)),
      getDelivery: vi.fn().mockResolvedValue(null),
      getOrderImageUrls: vi.fn().mockResolvedValue({}),
    };
    const { tracker, start } = track(api, ['v1']);
    await start();
    expect(tracker.diagnostics().nextCheckAt).toBeNull();
    await vi.advanceTimersByTimeAsync(ORDER_REFRESH_MS * 2);
    expect(api.getUserInfo).not.toHaveBeenCalled();
    expect(api.getOrderSnapshots).toHaveBeenCalledTimes(1);
  });
});
