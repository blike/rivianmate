import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { StatusResponse } from "../api-types.js";
import type { AppContext } from "../context.js";
import { hashPassword, verifyPassword } from "../crypto.js";
import { appSettings } from "../db/schema.js";

export const SESSION_COOKIE = "rivianmate_session";
const SESSION_TTL_MS = 30 * 24 * 3600_000;

const PASSWORD_KEY = "app_password_hash";

export async function getPasswordHash(ctx: AppContext): Promise<string | null> {
  const rows = await ctx.db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, PASSWORD_KEY));
  return rows[0]?.value ?? null;
}

export async function setPasswordHash(
  ctx: AppContext,
  hash: string,
): Promise<void> {
  await ctx.db
    .insert(appSettings)
    .values({ key: PASSWORD_KEY, value: hash })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: hash } });
}

const credentialsSchema = z.object({ password: z.string().min(8).max(200) });
const changeSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(8).max(200),
});

export async function authRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.get("/api/status", async (request): Promise<StatusResponse> => {
    const account = await ctx.tokenStore.load();
    return {
      needsSetup: (await getPasswordHash(ctx)) === null,
      authed: ctx.crypto.verifySession(request.cookies[SESSION_COOKIE]),
      rivianConnected: ctx.monitor.isRunning,
      rivianAuthState: account?.authState ?? null,
      rivianEmail: account?.email ?? null,
      mockMode: ctx.config.MOCK_RIVIAN,
    };
  });

  app.post("/api/setup", async (request, reply) => {
    if ((await getPasswordHash(ctx)) !== null) {
      return reply.code(409).send({ error: "Already set up" });
    }
    const body = credentialsSchema.parse(request.body);
    await setPasswordHash(ctx, hashPassword(body.password));
    issueSession(ctx, reply);
    return { ok: true };
  });

  app.post("/api/auth/login", async (request, reply) => {
    const body = credentialsSchema.parse(request.body);
    const hash = await getPasswordHash(ctx);
    if (!hash || !verifyPassword(body.password, hash)) {
      return reply.code(401).send({ error: "Invalid password" });
    }
    issueSession(ctx, reply);
    return { ok: true };
  });

  app.post("/api/auth/logout", async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.post("/api/auth/change-password", async (request, reply) => {
    const body = changeSchema.parse(request.body);
    const hash = await getPasswordHash(ctx);
    if (!hash || !verifyPassword(body.currentPassword, hash)) {
      return reply.code(401).send({ error: "Invalid password" });
    }
    await setPasswordHash(ctx, hashPassword(body.newPassword));
    return { ok: true };
  });

  app.get("/api/auth/session", async (request) => {
    return {
      authed: ctx.crypto.verifySession(request.cookies[SESSION_COOKIE]),
    };
  });
}

function issueSession(
  ctx: AppContext,
  reply: { setCookie: (name: string, value: string, opts: object) => unknown },
): void {
  reply.setCookie(SESSION_COOKIE, ctx.crypto.createSession(SESSION_TTL_MS), {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: SESSION_TTL_MS / 1000,
  });
}
