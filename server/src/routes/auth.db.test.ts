/**
 * Integration tests against a real Postgres. Skipped unless
 * TEST_DATABASE_URL points at a disposable database (tables are truncated).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import type { AppContext } from '../context.js';
import { createDb, runMigrations } from '../db/client.js';
import { silentLogger } from '../logger.js';
import { LoginThrottle } from '../services/login-throttle.js';
import { TokenCrypto } from '../crypto.js';

const url = process.env.TEST_DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));
const PASSWORD = 'correct horse battery staple';

describe.skipIf(!url)('auth with Postgres', () => {
  let handle: ReturnType<typeof createDb>;
  let app: FastifyInstance;

  const post = (path: string, payload: object, cookie?: string) =>
    app.inject({
      method: 'POST',
      url: path,
      payload,
      cookies: cookie ? { rivianmate_session: cookie } : {},
    });
  const cookieOf = (res: { cookies: { name: string; value: string }[] }) =>
    res.cookies.find((c) => c.name === 'rivianmate_session')?.value;
  const status = async (cookie?: string) =>
    (
      await app.inject({
        url: '/api/status',
        cookies: cookie ? { rivianmate_session: cookie } : {},
      })
    ).json();

  beforeAll(async () => {
    await runMigrations(url!, join(here, '..', '..', 'drizzle'));
    handle = createDb(url!);
  });
  afterAll(async () => {
    await app?.close();
    await handle.sql.end();
  });
  beforeEach(async () => {
    await handle.sql`TRUNCATE app_settings`;
    await app?.close();
    const ctx = {
      config: { MOCK_RIVIAN: false },
      log: silentLogger,
      db: handle.db,
      crypto: new TokenCrypto('a'.repeat(32)),
      loginThrottle: new LoginThrottle(Date.now, 3),
      tokenStore: {
        load: async () => ({ email: 'owner@example.com', authState: 'ok', tokens: {} }),
      },
      monitor: { isRunning: true },
      teslamate: { configured: false },
    } as unknown as AppContext;
    app = await buildApp(ctx);
  });

  it('sets the password once when two setups race', async () => {
    const results = await Promise.all([
      post('/api/setup', { password: PASSWORD }),
      post('/api/setup', { password: `${PASSWORD} two` }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const winner = results[0]!.statusCode === 200 ? PASSWORD : `${PASSWORD} two`;
    expect((await post('/api/auth/login', { password: winner })).statusCode).toBe(200);
  });

  it('describes the Rivian account only to someone signed in', async () => {
    const cookie = cookieOf(await post('/api/setup', { password: PASSWORD }));
    const anonymous = await status();
    expect(anonymous.authed).toBe(false);
    expect(anonymous.rivianEmail).toBeNull();
    expect(anonymous.rivianAuthState).toBeNull();
    const signedIn = await status(cookie);
    expect(signedIn.authed).toBe(true);
    expect(signedIn.rivianEmail).toBe('owner@example.com');
  });

  it('holds back an address after repeated wrong passwords', async () => {
    await post('/api/setup', { password: PASSWORD });
    for (let i = 0; i < 3; i++) {
      expect((await post('/api/auth/login', { password: 'wrong' })).statusCode).toBe(401);
    }
    const held = await post('/api/auth/login', { password: PASSWORD });
    expect(held.statusCode).toBe(429);
    expect(Number(held.headers['retry-after'])).toBeGreaterThan(0);
  });
});
