/**
 * Integration tests against a real Postgres. Skipped unless
 * TEST_DATABASE_URL points at a disposable database (tables are truncated).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LookupSettings } from '../api-types.js';
import { buildApp } from '../app.js';
import type { AppContext } from '../context.js';
import { TokenCrypto } from '../crypto.js';
import { createDb, runMigrations } from '../db/client.js';
import { silentLogger } from '../logger.js';
import { LoginThrottle } from '../services/login-throttle.js';
import { seedAppPassword } from './auth.js';

const url = process.env.TEST_DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));
const PASSWORD = 'correct horse battery staple';

describe.skipIf(!url)('lookup settings with Postgres', () => {
  let handle: ReturnType<typeof createDb>;
  let app: FastifyInstance;
  let cookie: string;
  let applied: LookupSettings[];

  const lookups = (payload?: LookupSettings) =>
    app.inject({
      method: payload ? 'PUT' : 'GET',
      url: '/api/settings/lookups',
      payload,
      cookies: { rivianmate_session: cookie },
    });

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
    applied = [];
    const ctx = {
      config: { MOCK_RIVIAN: false },
      log: silentLogger,
      db: handle.db,
      crypto: new TokenCrypto('a'.repeat(32)),
      loginThrottle: new LoginThrottle(),
      tokenStore: { load: async () => null },
      monitor: { isRunning: true, setLookups: (l: LookupSettings) => applied.push(l) },
      teslamate: { configured: false },
    } as unknown as AppContext;
    app = await buildApp(ctx);
    const setup = await app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { password: PASSWORD },
    });
    cookie = setup.cookies.find((c) => c.name === 'rivianmate_session')!.value;
  });

  it('has both lookups on for installs set up before there was a choice', async () => {
    await handle.sql`DELETE FROM app_settings WHERE key LIKE 'outside_lookups%'`;
    expect((await lookups()).json()).toEqual({ addresses: true, weather: true });
  });

  it('stores a change and applies it straight away', async () => {
    const off = { addresses: false, weather: true };
    expect((await lookups(off)).json()).toEqual(off);
    expect((await lookups()).json()).toEqual(off);
    expect(applied.at(-1)).toEqual(off);
  });

  it('refuses a setting that is not on or off', async () => {
    const res = await lookups({ addresses: 'no' } as unknown as LookupSettings);
    expect(res.statusCode).toBe(400);
    expect(applied).toHaveLength(1); // only the hold from setup
  });

  it('holds both lookups off from setup until they are chosen', async () => {
    const status = async () =>
      (await app.inject({ url: '/api/status', cookies: { rivianmate_session: cookie } })).json();
    const off = { addresses: false, weather: false };
    expect(applied).toEqual([off]);
    expect((await lookups()).json()).toEqual(off);
    expect((await status()).needsLookupChoice).toBe(true);

    const chosen = { addresses: true, weather: false };
    await lookups(chosen);
    expect(applied.at(-1)).toEqual(chosen);
    expect((await status()).needsLookupChoice).toBe(false);
  });

  it('with APP_PASSWORD, holds the lookups off from first boot and starts setup at sign-in', async () => {
    await handle.sql`TRUNCATE app_settings`;
    applied = [];
    const ctx = { db: handle.db, monitor: { setLookups: (l: LookupSettings) => applied.push(l) } };
    await seedAppPassword(ctx as unknown as AppContext, PASSWORD);
    expect(applied).toEqual([{ addresses: false, weather: false }]);

    const before = (await app.inject({ url: '/api/status' })).json();
    expect(before).toMatchObject({
      authed: false,
      needsLookupChoice: true,
      signInStartsSetup: true,
    });

    // A later boot leaves the password and the pending choice alone.
    await seedAppPassword(ctx as unknown as AppContext, `${PASSWORD} two`);
    expect(applied).toHaveLength(1);
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
  });

  it('starts setup at the password step without APP_PASSWORD', async () => {
    const status = (await app.inject({ url: '/api/status' })).json();
    expect(status).toMatchObject({ needsLookupChoice: true, signInStartsSetup: false });
  });
});
