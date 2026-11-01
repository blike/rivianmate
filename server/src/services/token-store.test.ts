import { describe, expect, it } from 'vitest';
import { TokenCrypto } from '../crypto.js';
import type { Db } from '../db/client.js';
import { TokenStore } from './token-store.js';

const crypto = new TokenCrypto('a'.repeat(32));
const row = (encryptedWith: TokenCrypto) => ({
  email: 'owner@example.com',
  authState: 'ok',
  accessTokenEnc: encryptedWith.encrypt('access'),
  refreshTokenEnc: encryptedWith.encrypt('refresh'),
  userSessionTokenEnc: encryptedWith.encrypt('session'),
});
const storeWith = (rows: object[]) =>
  new TokenStore(
    { select: () => ({ from: () => ({ limit: async () => rows }) }) } as unknown as Db,
    crypto,
  );

describe('TokenStore.summary', () => {
  it('describes an account with readable tokens', async () => {
    expect(await storeWith([row(crypto)]).summary()).toEqual({
      email: 'owner@example.com',
      authState: 'ok',
    });
  });

  it('keeps the email but asks for a sign-in after APP_SECRET changed', async () => {
    const store = storeWith([row(new TokenCrypto('b'.repeat(32)))]);
    expect(await store.summary()).toEqual({
      email: 'owner@example.com',
      authState: 'unauthenticated',
    });
    expect(await store.load()).toBeNull();
  });

  it('is empty with no account', async () => {
    expect(await storeWith([]).summary()).toBeNull();
  });
});
