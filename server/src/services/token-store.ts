import { eq } from "drizzle-orm";
import type { TokenCrypto } from "../crypto.js";
import type { Db } from "../db/client.js";
import { rivianAccount } from "../db/schema.js";
import type { RivianTokens } from "../rivian/types.js";

export type RivianAuthState = "ok" | "unauthenticated";

export interface StoredAccount {
  email: string;
  tokens: RivianTokens;
  authState: RivianAuthState;
}

/** Persists the (single) Rivian account with tokens encrypted at rest. */
export class TokenStore {
  constructor(
    private readonly db: Db,
    private readonly crypto: TokenCrypto,
  ) {}

  async load(): Promise<StoredAccount | null> {
    const rows = await this.db.select().from(rivianAccount).limit(1);
    const row = rows[0];
    if (!row) return null;
    try {
      return {
        email: row.email,
        authState: row.authState,
        tokens: {
          accessToken: this.crypto.decrypt(row.accessTokenEnc),
          refreshToken: this.crypto.decrypt(row.refreshTokenEnc),
          userSessionToken: this.crypto.decrypt(row.userSessionTokenEnc),
        },
      };
    } catch {
      // APP_SECRET changed: stored tokens are unrecoverable.
      return null;
    }
  }

  async save(email: string, tokens: RivianTokens): Promise<void> {
    const values = {
      id: 1,
      email,
      accessTokenEnc: this.crypto.encrypt(tokens.accessToken),
      refreshTokenEnc: this.crypto.encrypt(tokens.refreshToken),
      userSessionTokenEnc: this.crypto.encrypt(tokens.userSessionToken),
      authState: "ok" as const,
      updatedAt: new Date(),
      lastAuthOkAt: new Date(),
    };
    await this.db
      .insert(rivianAccount)
      .values(values)
      .onConflictDoUpdate({ target: rivianAccount.id, set: values });
  }

  async setAuthState(state: RivianAuthState): Promise<void> {
    await this.db
      .update(rivianAccount)
      .set({ authState: state, updatedAt: new Date() })
      .where(eq(rivianAccount.id, 1));
  }

  async clear(): Promise<void> {
    await this.db.delete(rivianAccount);
  }
}
