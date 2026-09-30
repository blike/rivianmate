import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  ConnectResponse,
  RivianDiagnosticsResponse,
} from "../api-types.js";
import type { AppContext } from "../context.js";
import {
  RivianInvalidCredentialsError,
  RivianInvalidOtpError,
  RivianRateLimitError,
  RivianUnauthenticatedError,
} from "../rivian/types.js";

const connectSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
const otpSchema = z.object({ code: z.string().min(4).max(10) });

export async function rivianRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.post("/api/rivian/connect", async (request, reply) => {
    const body = connectSchema.parse(request.body);
    const api = ctx.rivianFactory.createApi();
    try {
      const result = await api.login(body.email, body.password);
      if (result.kind === "otp") {
        ctx.pendingConnect = { api, email: body.email };
        return { ok: false, otpRequired: true } satisfies ConnectResponse;
      }
      ctx.pendingConnect = null;
      await ctx.tokenStore.save(body.email, result.tokens);
      await ctx.monitor.start(
        ctx.rivianFactory.createConnection(result.tokens, api),
      );
      return { ok: true } satisfies ConnectResponse;
    } catch (err) {
      return sendRivianError(reply, err);
    }
  });

  app.post("/api/rivian/otp", async (request, reply) => {
    const body = otpSchema.parse(request.body);
    const pending = ctx.pendingConnect;
    if (!pending) {
      return reply.code(409).send({ error: "No login awaiting OTP; start over" });
    }
    try {
      const tokens = await pending.api.loginWithOtp(pending.email, body.code);
      ctx.pendingConnect = null;
      await ctx.tokenStore.save(pending.email, tokens);
      await ctx.monitor.start(
        ctx.rivianFactory.createConnection(tokens, pending.api),
      );
      return { ok: true } satisfies ConnectResponse;
    } catch (err) {
      if (err instanceof RivianInvalidOtpError) {
        return reply.code(400).send({ error: "Invalid or expired code" });
      }
      ctx.pendingConnect = null;
      return sendRivianError(reply, err);
    }
  });

  app.get(
    "/api/rivian/diagnostics",
    async (): Promise<RivianDiagnosticsResponse> => ({
      monitor: ctx.monitor.diagnostics(),
      traffic: ctx.governor.snapshot(),
    }),
  );

  app.post("/api/rivian/disconnect", async () => {
    await ctx.monitor.stop();
    await ctx.tokenStore.clear();
    ctx.pendingConnect = null;
    return { ok: true };
  });
}

function sendRivianError(
  reply: { code: (c: number) => { send: (b: unknown) => unknown } },
  err: unknown,
): unknown {
  if (
    err instanceof RivianUnauthenticatedError ||
    err instanceof RivianInvalidCredentialsError
  ) {
    return reply.code(401).send({ error: "Rivian rejected the credentials" });
  }
  if (err instanceof RivianRateLimitError) {
    return reply
      .code(429)
      .send({ error: "Rivian is rate limiting; try again later" });
  }
  throw err;
}
