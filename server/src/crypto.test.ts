import { describe, expect, it } from 'vitest';
import {
  API_KEY_PREFIX,
  TokenCrypto,
  generateApiKey,
  hashApiKey,
  hashPassword,
  verifyPassword,
} from './crypto.js';

const SECRET = 'a'.repeat(32);

describe('TokenCrypto', () => {
  const crypto = new TokenCrypto(SECRET);

  it('round-trips encryption', () => {
    const token = 'some-rivian-access-token';
    expect(crypto.decrypt(crypto.encrypt(token))).toBe(token);
  });

  it('produces different ciphertext per call (random IV)', () => {
    expect(crypto.encrypt('x')).not.toBe(crypto.encrypt('x'));
  });

  it('fails to decrypt with a different secret', () => {
    const other = new TokenCrypto('b'.repeat(32));
    expect(() => other.decrypt(crypto.encrypt('x'))).toThrow();
  });

  it('verifies valid sessions and rejects expired/tampered ones', () => {
    const session = crypto.createSession(60_000);
    expect(crypto.verifySession(session)).toBe(true);
    expect(crypto.verifySession(undefined)).toBe(false);
    expect(crypto.verifySession('garbage')).toBe(false);
    expect(crypto.verifySession(session + 'x')).toBe(false);

    const expired = crypto.createSession(-1);
    expect(crypto.verifySession(expired)).toBe(false);

    const [, sig] = session.split('.');
    expect(crypto.verifySession(`${Date.now() + 9e9}.${sig}`)).toBe(false);
  });
});

describe('password hashing', () => {
  it('verifies correct password and rejects wrong one', async () => {
    const stored = await hashPassword('hunter22');
    expect(await verifyPassword('hunter22', stored)).toBe(true);
    expect(await verifyPassword('hunter23', stored)).toBe(false);
    expect(await verifyPassword('hunter22', 'malformed')).toBe(false);
  });
});

describe('API keys', () => {
  it('generates prefixed random keys with matching SHA-256 hashes', () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(a.prefix).toBe(a.key.slice(0, 12));
    expect(a.hash).toBe(hashApiKey(a.key));
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.key).not.toBe(b.key);
    expect(a.hash).not.toBe(b.hash);
  });
});
