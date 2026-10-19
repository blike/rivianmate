import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { TeslaMateSettingsDto } from '../api-types.js';
import type { AppContext } from '../context.js';
import { appSettings } from '../db/schema.js';
import { isPostgresUrl } from '../teslamate/source.js';

/** The connection URL, encrypted: it holds the database password. */
const URL_KEY = 'teslamate_url';

const updateSchema = z.object({ url: z.string().trim().min(1).max(2048) });

/** The saved TeslaMate URL; null when none is saved or it can't be decrypted. */
export async function getTeslaMateUrl(
  ctx: Pick<AppContext, 'db' | 'crypto'>,
): Promise<string | null> {
  const [row] = await ctx.db.select().from(appSettings).where(eq(appSettings.key, URL_KEY));
  if (!row) return null;
  try {
    return ctx.crypto.decrypt(row.value);
  } catch {
    // APP_SECRET changed; the URL has to be entered again.
    return null;
  }
}

export async function teslamateRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/api/settings/teslamate', async (): Promise<TeslaMateSettingsDto> =>
    ctx.teslamate.status(),
  );

  /** Tests the URL first, so a typo never replaces a working connection. */
  app.put('/api/settings/teslamate', async (request, reply) => {
    const { url } = updateSchema.parse(request.body);
    if (!isPostgresUrl(url)) {
      return reply
        .code(400)
        .send({ error: 'Enter a Postgres URL, like postgres://user:password@host:5432/teslamate' });
    }
    try {
      await ctx.teslamate.test(url);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
    const value = ctx.crypto.encrypt(url);
    await ctx.db
      .insert(appSettings)
      .values({ key: URL_KEY, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value } });
    await ctx.teslamate.configure(url);
    return ctx.teslamate.status();
  });

  app.delete('/api/settings/teslamate', async (): Promise<TeslaMateSettingsDto> => {
    await ctx.db.delete(appSettings).where(eq(appSettings.key, URL_KEY));
    await ctx.teslamate.configure(null);
    return ctx.teslamate.status();
  });
}
