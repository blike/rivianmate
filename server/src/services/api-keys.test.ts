import { describe, expect, it, vi } from 'vitest';
import { hashApiKey } from '../crypto.js';
import type { Db } from '../db/client.js';
import { ApiKeyLimitError, ApiKeyStore, MAX_API_KEYS } from './api-keys.js';

interface StoredRow {
  id: number;
  name: string;
  prefix: string;
  keyHash: string;
  scope: 'read';
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
}

function fakeDb(initial: StoredRow[] = []) {
  const rows = [...initial];
  let nextId = rows.reduce((max, r) => Math.max(max, r.id), 0) + 1;
  const updates: { id: number; lastUsedAt: Date }[] = [];

  const db = {
    select: (fields?: Record<string, unknown>) => ({
      from: () => {
        if (fields && 'total' in fields) {
          return Promise.resolve([{ total: rows.length }]);
        }
        return {
          orderBy: () => Promise.resolve([...rows].reverse()),
          where: () => ({
            limit: () => {
              // Matches the hash stored on the first matching row if present.
              return Promise.resolve(rows.slice(0, 1));
            },
          }),
        };
      },
    }),
    insert: () => ({
      values: (vals: Omit<StoredRow, 'id' | 'createdAt' | 'lastUsedAt'>) => ({
        returning: () => {
          const row: StoredRow = {
            id: nextId++,
            name: vals.name,
            prefix: vals.prefix,
            keyHash: vals.keyHash,
            scope: vals.scope,
            createdAt: new Date('2026-11-24T12:00:00.000Z'),
            lastUsedAt: null,
            expiresAt: vals.expiresAt,
          };
          rows.push(row);
          return Promise.resolve([row]);
        },
      }),
    }),
    update: () => ({
      set: (vals: { lastUsedAt: Date }) => ({
        where: () => {
          if (rows[0]) {
            rows[0].lastUsedAt = vals.lastUsedAt;
            updates.push({ id: rows[0].id, lastUsedAt: vals.lastUsedAt });
          }
          return Promise.resolve();
        },
      }),
    }),
    delete: () => ({
      where: () => ({
        returning: () => {
          const removed = rows.shift();
          return Promise.resolve(removed ? [{ id: removed.id }] : []);
        },
      }),
    }),
  } as unknown as Db;

  return { db, rows, updates };
}

describe('ApiKeyStore', () => {
  it('fast-rejects keys without the rmk_ prefix or overly long keys without querying the db', async () => {
    const select = vi.fn();
    const store = new ApiKeyStore({ select } as unknown as Db);
    expect(await store.verify('not-a-key')).toBeNull();
    expect(await store.verify(`rmk_${'a'.repeat(200)}`)).toBeNull();
    expect(select).not.toHaveBeenCalled();
  });

  it('creates a hashed key, verifies it, throttles lastUsedAt updates, and rejects expired keys', async () => {
    let now = new Date('2026-11-24T12:00:00.000Z');
    const { db, rows, updates } = fakeDb();
    const store = new ApiKeyStore(db, undefined, () => now);

    const created = await store.create({
      name: 'Home Assistant',
      expiresAt: new Date('2026-11-25T12:00:00.000Z'),
    });
    expect(created.key.startsWith('rmk_')).toBe(true);
    expect(rows[0]!.keyHash).toBe(hashApiKey(created.key));
    expect(rows[0]!.scope).toBe('read');

    // First verify touches lastUsedAt.
    expect(await store.verify(created.key)).toEqual({ id: created.id });
    expect(updates).toHaveLength(1);

    // Within 60s, lastUsedAt is not written again.
    now = new Date('2026-11-24T12:00:30.000Z');
    expect(await store.verify(created.key)).toEqual({ id: created.id });
    expect(updates).toHaveLength(1);

    // After 60s, lastUsedAt updates again.
    now = new Date('2026-11-24T12:01:05.000Z');
    expect(await store.verify(created.key)).toEqual({ id: created.id });
    expect(updates).toHaveLength(2);

    // Past expiresAt, verification fails.
    now = new Date('2026-11-25T12:00:00.000Z');
    expect(await store.verify(created.key)).toBeNull();
  });

  it('enforces the maximum key count', async () => {
    const full: StoredRow[] = Array.from({ length: MAX_API_KEYS }, (_, i) => ({
      id: i + 1,
      name: `Key ${i}`,
      prefix: 'rmk_12345678',
      keyHash: `${i}`,
      scope: 'read',
      createdAt: new Date(),
      lastUsedAt: null,
      expiresAt: null,
    }));
    const { db } = fakeDb(full);
    const store = new ApiKeyStore(db);
    await expect(store.create({ name: 'One too many', expiresAt: null })).rejects.toThrow(
      ApiKeyLimitError,
    );
  });
});
