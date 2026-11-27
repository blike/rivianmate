import { count, desc, eq } from 'drizzle-orm';
import type { ApiKeyDto, CreatedApiKeyDto } from '../api-types.js';
import { API_KEY_PREFIX, generateApiKey, hashApiKey } from '../crypto.js';
import type { Db } from '../db/client.js';
import { apiKeys } from '../db/schema.js';
import { type Logger, silentLogger } from '../logger.js';

export const MAX_API_KEYS = 50;
/** Minimum interval between `lastUsedAt` writes for the same key. */
const LAST_USED_TOUCH_MS = 60_000;
const MAX_KEY_LENGTH = 128;

export class ApiKeyLimitError extends Error {
  constructor() {
    super(`At most ${MAX_API_KEYS} API keys can exist at once`);
  }
}

export interface VerifiedApiKey {
  id: number;
}

function toDto(row: typeof apiKeys.$inferSelect): ApiKeyDto {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
  };
}

export class ApiKeyStore {
  constructor(
    private readonly db: Db,
    private readonly log: Logger = silentLogger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(): Promise<ApiKeyDto[]> {
    const rows = await this.db
      .select()
      .from(apiKeys)
      .orderBy(desc(apiKeys.createdAt), desc(apiKeys.id));
    return rows.map(toDto);
  }

  async create(input: { name: string; expiresAt: Date | null }): Promise<CreatedApiKeyDto> {
    const [counts] = await this.db.select({ total: count() }).from(apiKeys);
    if ((counts?.total ?? 0) >= MAX_API_KEYS) throw new ApiKeyLimitError();

    const generated = generateApiKey();
    const [row] = await this.db
      .insert(apiKeys)
      .values({
        name: input.name,
        prefix: generated.prefix,
        keyHash: generated.hash,
        scope: 'read',
        expiresAt: input.expiresAt,
      })
      .returning();

    return {
      ...toDto(row!),
      key: generated.key,
    };
  }

  async revoke(id: number): Promise<boolean> {
    const deleted = await this.db
      .delete(apiKeys)
      .where(eq(apiKeys.id, id))
      .returning({ id: apiKeys.id });
    return deleted.length > 0;
  }

  async verify(rawKey: string): Promise<VerifiedApiKey | null> {
    if (!rawKey.startsWith(API_KEY_PREFIX) || rawKey.length > MAX_KEY_LENGTH) return null;
    const keyHash = hashApiKey(rawKey);
    const [row] = await this.db.select().from(apiKeys).where(eq(apiKeys.keyHash, keyHash)).limit(1);
    if (!row) return null;

    const current = this.now();
    if (row.expiresAt && row.expiresAt.getTime() <= current.getTime()) return null;

    if (!row.lastUsedAt || current.getTime() - row.lastUsedAt.getTime() >= LAST_USED_TOUCH_MS) {
      void this.db
        .update(apiKeys)
        .set({ lastUsedAt: current })
        .where(eq(apiKeys.id, row.id))
        .catch((err: unknown) => {
          this.log.warn({ err, keyId: row.id }, 'failed to update api key lastUsedAt');
        });
    }

    return { id: row.id };
  }
}
