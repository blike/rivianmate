import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import type { AppContext } from './context.js';
import { TokenCrypto } from './crypto.js';
import { silentLogger } from './logger.js';

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
