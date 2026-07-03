import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { ZodError } from "zod";
import type { AppContext } from "./context.js";
import { SESSION_COOKIE, authRoutes } from "./routes/auth.js";
import { chargingRoutes } from "./routes/charging.js";
import { historyRoutes } from "./routes/history.js";
import { rivianRoutes } from "./routes/rivian.js";
import { vehicleRoutes } from "./routes/vehicles.js";

const PUBLIC_PATHS = new Set(["/api/status", "/api/setup", "/api/auth/login"]);

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: ctx.config.NODE_ENV === "production" ? "info" : "debug" },
  });

  await app.register(fastifyCookie);

  app.addHook("preHandler", async (request, reply) => {
    const path = request.url.split("?")[0] ?? "";
    if (!path.startsWith("/api/") || PUBLIC_PATHS.has(path)) return;
    if (!ctx.crypto.verifySession(request.cookies[SESSION_COOKIE])) {
      return reply.code(401).send({ error: "Not authenticated" });
    }
  });

  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: "Invalid request",
        details: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }
    app.log.error(err);
    return reply.code(500).send({ error: "Internal error" });
  });

  await authRoutes(app, ctx);
  await rivianRoutes(app, ctx);
  await vehicleRoutes(app, ctx);
  await historyRoutes(app, ctx);
  await chargingRoutes(app, ctx);

  if (ctx.config.WEB_DIST && existsSync(ctx.config.WEB_DIST)) {
    await app.register(fastifyStatic, { root: ctx.config.WEB_DIST });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/api/")) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "Not found" });
    });
  }

  return app;
}
