import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { StatusResponse } from '../api-types.js';
import type { AppContext } from '../context.js';
import { hashPassword, verifyPassword } from '../crypto.js';
import { appSettings } from '../db/schema.js';
import { passwordProblem } from '../password-policy.js';

export const SESSION_COOKIE = 'rivianmate_session';
const SESSION_TTL_MS = 30 * 24 * 3600_000;

const PASSWORD_KEY = 'app_password_hash';

export async function getPasswordHash(ctx: AppContext): Promise<string | null> {
  const rows = await ctx.db.select().from(appSettings).where(eq(appSettings.key, PASSWORD_KEY));
  return rows[0]?.value ?? null;
}

export async function setPasswordHash(ctx: AppContext, hash: string): Promise<void> {
  await ctx.db
    .insert(appSettings)
    .values({ key: PASSWORD_KEY, value: hash })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: hash } });
}

// Login accepts any length so passwords set under an older policy still work;
// new passwords are checked against the policy in the handlers.
const MAX_INPUT_LENGTH = 1024;
const credentialsSchema = z.object({ password: z.string().min(1).max(MAX_INPUT_LENGTH) });
const changeSchema = z.object({
  currentPassword: z.string().max(MAX_INPUT_LENGTH),
  newPassword: z.string().max(MAX_INPUT_LENGTH),
});

/** Whether the request carries a live session cookie. */
export function isAuthed(ctx: AppContext, request: FastifyRequest): boolean {
  return ctx.crypto.verifySession(request.cookies[SESSION_COOKIE]);
}

/**
 * Checks a password against the stored hash, counting failures toward the
 * client's limit; replies 429 or 401 and returns false when it can't go on.
 */
async function checkPassword(
  ctx: AppContext,
  request: FastifyRequest,
  reply: FastifyReply,
  password: string,
): Promise<boolean> {
  const wait = ctx.loginThrottle.retryAfter(request.ip);
  if (wait > 0) {
    await reply
      .code(429)
      .header('Retry-After', String(wait))
      .send({ error: 'Too many attempts; try again later' });
    return false;
  }
  const hash = await getPasswordHash(ctx);
  if (!hash || !(await verifyPassword(password, hash))) {
    ctx.loginThrottle.fail(request.ip);
    await reply.code(401).send({ error: 'Invalid password' });
    return false;
  }
  ctx.loginThrottle.succeed(request.ip);
  return true;
}

export async function authRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/api/status', async (request): Promise<StatusResponse> => {
    const authed = isAuthed(ctx, request);
    // The account is only described to someone signed in.
    const account = authed ? await ctx.tokenStore.load() : null;
    return {
      needsSetup: (await getPasswordHash(ctx)) === null,
      authed,
      rivianConnected: ctx.monitor.isRunning,
      rivianAuthState: account?.authState ?? null,
      rivianEmail: account?.email ?? null,
      mockMode: ctx.config.MOCK_RIVIAN,
      teslamateConfigured: ctx.teslamate.configured,
    };
  });

  app.post('/api/setup', async (request, reply) => {
    if ((await getPasswordHash(ctx)) !== null) {
      return reply.code(409).send({ error: 'Already set up' });
    }
    const body = credentialsSchema.parse(request.body);
    const problem = passwordProblem(body.password);
    if (problem) return reply.code(400).send({ error: problem });
    // Only the first of two setups racing each other sets the password.
    const created = await ctx.db
      .insert(appSettings)
      .values({ key: PASSWORD_KEY, value: await hashPassword(body.password) })
      .onConflictDoNothing()
      .returning();
    if (!created.length) return reply.code(409).send({ error: 'Already set up' });
    issueSession(ctx, reply);
    return { ok: true };
  });

  app.post('/api/auth/login', async (request, reply) => {
    const body = credentialsSchema.parse(request.body);
    if (!(await checkPassword(ctx, request, reply, body.password))) return reply;
    issueSession(ctx, reply);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.post('/api/auth/change-password', async (request, reply) => {
    const body = changeSchema.parse(request.body);
    if (!(await checkPassword(ctx, request, reply, body.currentPassword))) return reply;
    const problem = passwordProblem(body.newPassword);
    if (problem) return reply.code(400).send({ error: problem });
    if (body.newPassword === body.currentPassword) {
      return reply.code(400).send({ error: 'Choose a password different from the current one' });
    }
    await setPasswordHash(ctx, await hashPassword(body.newPassword));
    return { ok: true };
  });

  app.get('/api/auth/session', async (request) => {
    return { authed: isAuthed(ctx, request) };
  });
}

function issueSession(ctx: AppContext, reply: FastifyReply): void {
  reply.setCookie(SESSION_COOKIE, ctx.crypto.createSession(SESSION_TTL_MS), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS / 1000,
  });
}
