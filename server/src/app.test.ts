import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ApiKeyScope } from './api-types.js';
import { buildApp } from './app.js';
import type { AppContext } from './context.js';
import { TokenCrypto, hashPassword } from './crypto.js';
import { silentLogger } from './logger.js';
import { LoginThrottle } from './services/login-throttle.js';

const PASSWORD = 'correct horse battery staple';

function mockApiKeys(keys: Record<string, { id: number; scope: ApiKeyScope }>) {
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
  const readKey = 'rmk_readkey_test_1234567890';
  const writeKey = 'rmk_writekey_test_1234567890';
  let app: FastifyInstance;

  beforeAll(async () => {
    const ctx = {
      config: { MOCK_RIVIAN: false, TRUST_PROXY: false },
      log: silentLogger,
      crypto,
      apiKeys: mockApiKeys({
        [readKey]: { id: 1, scope: 'read' },
        [writeKey]: { id: 2, scope: 'write' },
      }),
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

  it('accepts a valid Bearer API key on read endpoints and reports its scope on /api/auth/session', async () => {
    const version = await app.inject({
      url: '/api/version',
      headers: { authorization: `Bearer ${readKey}` },
    });
    expect(version.statusCode).toBe(200);

    const session = await app.inject({
      url: '/api/auth/session',
      headers: { authorization: `Bearer ${readKey}` },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toEqual({ authed: true, method: 'api_key', scope: 'read' });

    const cookieSession = await app.inject({
      url: '/api/auth/session',
      cookies: { rivianmate_session: crypto.createSession(60_000) },
    });
    expect(cookieSession.statusCode).toBe(200);
    expect(cookieSession.json()).toEqual({ authed: true, method: 'session' });
  });

  it('rejects an invalid Authorization header without falling back to a session cookie', async () => {
    const res = await app.inject({
      url: '/api/version',
      headers: { authorization: 'Bearer rmk_invalid' },
      cookies: { rivianmate_session: crypto.createSession(60_000) },
    });
    expect(res.statusCode).toBe(401);

    const malformed = await app.inject({
      url: '/api/version',
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
      cookies: { rivianmate_session: crypto.createSession(60_000) },
    });
    expect(malformed.statusCode).toBe(401);
  });

  it('blocks read-only API keys from mutating endpoints', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/units',
      headers: { authorization: `Bearer ${readKey}` },
      payload: { distance: 'km', temperature: 'C' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('API key has read-only access');
  });

  it('allows write API keys onto non-security mutating endpoints', async () => {
    // Validation fails with 400 inside the handler, proving preHandler allowed the request through.
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/units',
      headers: { authorization: `Bearer ${writeKey}` },
      payload: { distance: 'invalid' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('blocks both read and write API keys from session-only security endpoints', async () => {
    const cases: { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; url: string }[] = [
      { method: 'GET', url: '/api/api-keys' },
      { method: 'GET', url: '/%61pi/api-keys' },
      { method: 'POST', url: '/api/api-keys' },
      { method: 'DELETE', url: '/api/api-keys/1' },
      { method: 'POST', url: '/api/auth/change-password' },
      { method: 'POST', url: '/api/auth/logout' },
      { method: 'POST', url: '/api/rivian/connect' },
      { method: 'POST', url: '/api/rivian/otp' },
      { method: 'POST', url: '/api/rivian/disconnect' },
      { method: 'PUT', url: '/api/settings/teslamate' },
      { method: 'DELETE', url: '/api/settings/teslamate' },
    ];
    for (const key of [readKey, writeKey]) {
      for (const c of cases) {
        const res = await app.inject({
          method: c.method,
          url: c.url,
          headers: { authorization: `Bearer ${key}` },
        });
        expect(res.statusCode, `${c.method} ${c.url}`).toBe(403);
        expect(res.json().error).toBe('This endpoint requires a browser session');
      }
    }
  });
});

describe('TRUST_PROXY and Secure session cookies', () => {
  const crypto = new TokenCrypto('a'.repeat(32));

  async function createLoginApp(trustProxy: boolean | number) {
    const hash = await hashPassword(PASSWORD);
    const db = {
      select: () => ({
        from: () => ({
          where: async () => [{ key: 'app_password_hash', value: hash }],
        }),
      }),
    };
    const ctx = {
      config: { MOCK_RIVIAN: false, TRUST_PROXY: trustProxy },
      log: silentLogger,
      db,
      crypto,
      loginThrottle: new LoginThrottle(Date.now, 2),
    } as unknown as AppContext;
    return buildApp(ctx);
  }

  it('ignores X-Forwarded-Proto and X-Forwarded-For when TRUST_PROXY is false', async () => {
    const app = await createLoginApp(false);
    try {
      const ok = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.10' },
        payload: { password: PASSWORD },
      });
      expect(ok.statusCode).toBe(200);
      const cookie = ok.cookies.find((c) => c.name === 'rivianmate_session');
      expect(cookie?.secure).toBeFalsy();

      // Different X-Forwarded-For values still share the same throttle bucket when untrusted.
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'x-forwarded-for': '203.0.113.1' },
        payload: { password: 'wrong' },
      });
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'x-forwarded-for': '203.0.113.2' },
        payload: { password: 'wrong' },
      });
      const throttled = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'x-forwarded-for': '203.0.113.3' },
        payload: { password: PASSWORD },
      });
      expect(throttled.statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });

  it('sets Secure cookie over proxied HTTPS and throttles per client IP when TRUST_PROXY is enabled', async () => {
    const app = await createLoginApp(1);
    try {
      const httpsLogin = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.10' },
        payload: { password: PASSWORD },
      });
      expect(httpsLogin.statusCode).toBe(200);
      const httpsCookie = httpsLogin.cookies.find((c) => c.name === 'rivianmate_session');
      expect(httpsCookie?.secure).toBe(true);
      expect(httpsCookie?.httpOnly).toBe(true);
      expect(httpsCookie?.sameSite).toBe('Lax');

      // Plain HTTP still omits Secure so local access keeps working.
      const httpLogin = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'x-forwarded-proto': 'http', 'x-forwarded-for': '203.0.113.11' },
        payload: { password: PASSWORD },
      });
      expect(httpLogin.cookies.find((c) => c.name === 'rivianmate_session')?.secure).toBeFalsy();

      // Exhausting login attempts from one client IP does not throttle a different client IP.
      for (let i = 0; i < 2; i++) {
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          headers: { 'x-forwarded-for': '203.0.113.20' },
          payload: { password: 'wrong' },
        });
      }
      const blocked = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'x-forwarded-for': '203.0.113.20' },
        payload: { password: PASSWORD },
      });
      expect(blocked.statusCode).toBe(429);

      const otherClient = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'x-forwarded-for': '203.0.113.21' },
        payload: { password: PASSWORD },
      });
      expect(otherClient.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
