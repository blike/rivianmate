import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import type { AppContext } from '../context.js';
import { TokenCrypto } from '../crypto.js';
import { silentLogger } from '../logger.js';

describe('connecting a Rivian account', () => {
  const crypto = new TokenCrypto('a'.repeat(32));
  let app: FastifyInstance;
  const connect = (payload: object) =>
    app.inject({
      method: 'POST',
      url: '/api/rivian/connect',
      payload,
      cookies: { rivianmate_session: crypto.createSession(60_000) },
    });

  beforeAll(async () => {
    // Turned away before Rivian is called, so nothing else is needed.
    const ctx = { config: {}, log: silentLogger, crypto } as unknown as AppContext;
    app = await buildApp(ctx);
  });
  afterAll(() => app.close());

  it('says what is wrong with an email the browser lets through', async () => {
    const res = await connect({ email: 'sda@ads', password: 'x' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe(
      'Enter the full email address for your Rivian account, like name@example.com.',
    );
  });

  it('asks for the password when it is missing', async () => {
    const res = await connect({ email: 'owner@example.com', password: '' });
    expect(res.json().error).toBe('Enter your Rivian password.');
  });
});
