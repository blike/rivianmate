import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import type { AppContext } from './context.js';
import { TokenCrypto, hashPassword } from './crypto.js';
import { silentLogger } from './logger.js';
import { LoginThrottle } from './services/login-throttle.js';

const PASSWORD = 'correct horse battery staple';

describe('API authentication', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Requests here are turned away before any handler needs the rest.
    const ctx = {
      config: {},
      log: silentLogger,
      crypto: new TokenCrypto('a'.repeat(32)),
    } as unknown as AppContext;
    app = await buildApp(ctx);
  });
  afterAll(() => app.close());

  it('turns away requests without a session', async () => {
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
});

describe('TRUST_PROXY and Secure session cookies', () => {
  const crypto = new TokenCrypto('a'.repeat(32));

  async function createLoginApp(trustProxy: false | string[]) {
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
        remoteAddress: '172.18.0.2',
        headers: { 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.10' },
        payload: { password: PASSWORD },
      });
      expect(ok.statusCode).toBe(200);
      const cookie = ok.cookies.find((c) => c.name === 'rivianmate_session');
      expect(cookie?.secure).toBeFalsy();

      // Different X-Forwarded-For values share the real socket IP throttle bucket when untrusted.
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: '172.18.0.2',
        headers: { 'x-forwarded-for': '203.0.113.1' },
        payload: { password: 'wrong' },
      });
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: '172.18.0.2',
        headers: { 'x-forwarded-for': '203.0.113.2' },
        payload: { password: 'wrong' },
      });
      const throttled = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: '172.18.0.2',
        headers: { 'x-forwarded-for': '203.0.113.3' },
        payload: { password: PASSWORD },
      });
      expect(throttled.statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });

  it('trusts forwarded headers only from configured proxy IPs/CIDRs', async () => {
    const app = await createLoginApp(['172.18.0.0/16']);
    try {
      // Request from the trusted proxy over HTTPS sets a Secure cookie.
      const httpsLogin = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: '172.18.0.2',
        headers: { 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.10' },
        payload: { password: PASSWORD },
      });
      expect(httpsLogin.statusCode).toBe(200);
      const httpsCookie = httpsLogin.cookies.find((c) => c.name === 'rivianmate_session');
      expect(httpsCookie?.secure).toBe(true);
      expect(httpsCookie?.httpOnly).toBe(true);
      expect(httpsCookie?.sameSite).toBe('Lax');

      // Logout over proxied HTTPS clears the cookie with matching Secure attribute.
      const logout = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        remoteAddress: '172.18.0.2',
        headers: { 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.10' },
        cookies: { rivianmate_session: httpsCookie!.value },
      });
      expect(logout.statusCode).toBe(200);
      expect(logout.cookies.find((c) => c.name === 'rivianmate_session')?.secure).toBe(true);

      // Plain HTTP omits Secure so local access continues to work.
      const httpLogin = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: '172.18.0.2',
        headers: { 'x-forwarded-proto': 'http', 'x-forwarded-for': '203.0.113.11' },
        payload: { password: PASSWORD },
      });
      expect(httpLogin.cookies.find((c) => c.name === 'rivianmate_session')?.secure).toBeFalsy();

      // Throttling tracks each forwarded client IP behind the trusted proxy.
      for (let i = 0; i < 2; i++) {
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          remoteAddress: '172.18.0.2',
          headers: { 'x-forwarded-for': '203.0.113.20' },
          payload: { password: 'wrong' },
        });
      }
      const blocked = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: '172.18.0.2',
        headers: { 'x-forwarded-for': '203.0.113.20' },
        payload: { password: PASSWORD },
      });
      expect(blocked.statusCode).toBe(429);

      const otherClient = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: '172.18.0.2',
        headers: { 'x-forwarded-for': '203.0.113.21' },
        payload: { password: PASSWORD },
      });
      expect(otherClient.statusCode).toBe(200);

      // Direct connections that bypass the proxy cannot spoof X-Forwarded-For or X-Forwarded-Proto.
      const spoofedOk = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: '198.51.100.50',
        headers: { 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.99' },
        payload: { password: PASSWORD },
      });
      expect(spoofedOk.statusCode).toBe(200);
      expect(spoofedOk.cookies.find((c) => c.name === 'rivianmate_session')?.secure).toBeFalsy();

      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: '198.51.100.50',
        headers: { 'x-forwarded-for': '198.51.100.1' },
        payload: { password: 'wrong' },
      });
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: '198.51.100.50',
        headers: { 'x-forwarded-for': '198.51.100.2' },
        payload: { password: 'wrong' },
      });
      const spoofedThrottled = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: '198.51.100.50',
        headers: { 'x-forwarded-for': '198.51.100.3' },
        payload: { password: PASSWORD },
      });
      expect(spoofedThrottled.statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });
});
