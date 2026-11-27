import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import type { AppContext } from './context.js';
import { TokenCrypto } from './crypto.js';
import { silentLogger } from './logger.js';

function mockApiKeys(keys: Record<string, { id: number }>) {
  return {
    list: async () => [],
    create: async () => {
      throw new Error('not implemented');
    },
    revoke: async () => false,
    verify: async (raw: string) => keys[raw] ?? null,
  };
}

describe('API authentication and authorization', () => {
  const crypto = new TokenCrypto('a'.repeat(32));
  const apiKey = 'rmk_readkey_test_1234567890';
  let app: FastifyInstance;

  beforeAll(async () => {
    const ctx = {
      config: { MOCK_RIVIAN: false },
      log: silentLogger,
      db: {
        select: () => ({
          from: async () => [],
        }),
      },
      crypto,
      apiKeys: mockApiKeys({
        [apiKey]: { id: 1 },
      }),
      monitor: {
        getVehicles: () => [
          { id: 'v1', vin: '7PDS1', name: 'Blue', make: 'Rivian', model: 'R1S', modelYear: 2025 },
        ],
        getState: (id: string) =>
          id === 'v1'
            ? {
                batteryLevel: { timeStamp: '2026-11-24T20:00:00Z', value: 80 },
                vehicleMileage: { timeStamp: '2026-11-24T20:00:00Z', value: 518000 },
                cabinClimateInteriorTemperature: { timeStamp: '2026-11-24T20:00:00Z', value: 20 },
              }
            : undefined,
      },
      teslamate: { getVehicles: () => [] },
      bus: { latestChargingSession: () => null },
    } as unknown as AppContext;
    app = await buildApp(ctx);
  });
  afterAll(() => app.close());

  it('turns away requests without a session or API key', async () => {
    const res = await app.inject({ url: '/api/vehicles' });
    expect(res.statusCode).toBe(401);
  });

  it('turns away a percent-encoded path to the same route', async () => {
    for (const url of ['/%61pi/vehicles', '/%61%70%69/vehicles/v1/state', '/api/%76ehicles']) {
      const res = await app.inject({ url });
      expect(res.statusCode, url).toBe(401);
    }
  });

  it('turns away a cookie that is not a live session', async () => {
    const res = await app.inject({ url: '/api/vehicles', cookies: { rivianmate_session: 'bad' } });
    expect(res.statusCode).toBe(401);
  });

  it('accepts a valid Bearer API key on allowlisted public endpoints', async () => {
    const vehicles = await app.inject({
      url: '/api/vehicles',
      headers: { authorization: `Bearer ${apiKey}` },
    });
    expect(vehicles.statusCode).toBe(200);
    expect(vehicles.json()).toEqual([
      {
        id: 'v1',
        vin: '7PDS1',
        name: 'Blue',
        make: 'Rivian',
        model: 'R1S',
        modelYear: 2025,
        renders: [],
        source: 'rivian',
      },
    ]);

    const summary = await app.inject({
      url: '/api/vehicles/v1/summary?units=imperial',
      headers: { authorization: `Bearer ${apiKey}` },
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toMatchObject({
      id: 'v1',
      name: 'Blue',
      batteryLevel: 80,
      odometer: 321.9,
      cabinTemp: 68,
      units: { distance: 'mi', temperature: 'F' },
    });

    const missingSummary = await app.inject({
      url: '/api/vehicles/unknown/summary',
      headers: { authorization: `Bearer ${apiKey}` },
    });
    expect(missingSummary.statusCode).toBe(404);
  });

  it('still accepts session cookies on internal routes', async () => {
    const cookieSession = await app.inject({
      url: '/api/auth/session',
      cookies: { rivianmate_session: crypto.createSession(60_000) },
    });
    expect(cookieSession.statusCode).toBe(200);
    expect(cookieSession.json()).toEqual({ authed: true });
  });

  it('rejects an invalid Authorization header without falling back to a session cookie', async () => {
    const res = await app.inject({
      url: '/api/vehicles',
      headers: { authorization: 'Bearer rmk_invalid' },
      cookies: { rivianmate_session: crypto.createSession(60_000) },
    });
    expect(res.statusCode).toBe(401);

    const malformed = await app.inject({
      url: '/api/vehicles',
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
      cookies: { rivianmate_session: crypto.createSession(60_000) },
    });
    expect(malformed.statusCode).toBe(401);
  });

  it('rejects write scope requests when creating API keys', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/api-keys',
      cookies: { rivianmate_session: crypto.createSession(60_000) },
      payload: { name: 'Bad key', scope: 'write' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('blocks API keys from all non-allowlisted endpoints', async () => {
    const cases: { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; url: string }[] = [
      { method: 'GET', url: '/api/vehicles/v1/state' },
      { method: 'GET', url: '/%61pi/vehicles/v1/state' },
      { method: 'GET', url: '/api/vehicles/v1/drives' },
      { method: 'GET', url: '/api/locations' },
      { method: 'GET', url: '/api/settings/notifications' },
      { method: 'GET', url: '/api/logs/stream' },
      { method: 'GET', url: '/api/version' },
      { method: 'GET', url: '/api/auth/session' },
      { method: 'GET', url: '/api/api-keys' },
      { method: 'GET', url: '/%61pi/api-keys' },
      { method: 'POST', url: '/api/api-keys' },
      { method: 'DELETE', url: '/api/api-keys/1' },
      { method: 'PUT', url: '/api/settings/units' },
      { method: 'POST', url: '/api/auth/change-password' },
      { method: 'POST', url: '/api/auth/logout' },
      { method: 'POST', url: '/api/rivian/connect' },
      { method: 'POST', url: '/api/rivian/otp' },
      { method: 'POST', url: '/api/rivian/disconnect' },
      { method: 'PUT', url: '/api/settings/teslamate' },
      { method: 'DELETE', url: '/api/settings/teslamate' },
    ];
    for (const c of cases) {
      const res = await app.inject({
        method: c.method,
        url: c.url,
        headers: { authorization: `Bearer ${apiKey}` },
      });
      expect(res.statusCode, `${c.method} ${c.url}`).toBe(403);
      expect(res.json().error).toBe('This endpoint requires a browser session');
    }
  });
});
