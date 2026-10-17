import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  LogController,
} from 'fastify';
import { existsSync } from 'node:fs';
import { ZodError } from 'zod';
import type { AppContext } from './context.js';
import { SESSION_COOKIE, authRoutes } from './routes/auth.js';
import { chargingRoutes } from './routes/charging.js';
import { historyRoutes } from './routes/history.js';
import { locationRoutes } from './routes/locations.js';
import { rivianRoutes } from './routes/rivian.js';
import { healthRoutes } from './routes/health.js';
import { notificationRoutes } from './routes/notifications.js';
import { settingsRoutes } from './routes/settings.js';
import { vehicleRoutes } from './routes/vehicles.js';

const PUBLIC_PATHS = new Set(['/api/status', '/api/setup', '/api/auth/login']);
const ASSET_PATH_PATTERN = /\/[^/]+\.[^/]+$/;
/** Requests slower than this are worth seeing at the default log level. */
const SLOW_REQUEST_MS = 1000;

/**
 * The UI polls constantly, so a line per request buries everything else: only
 * failures and slow requests are logged by default, the rest at debug.
 */
class QuietRequestLog extends LogController {
  override incomingRequest(): void {}

  override requestCompleted(
    error: Error | null | undefined,
    request: FastifyRequest,
    reply: FastifyReply,
  ): void {
    const ms = Math.round(reply.elapsedTime);
    const status = reply.statusCode;
    const level =
      error || status >= 500 ? 'warn' : status >= 400 || ms > SLOW_REQUEST_MS ? 'info' : 'debug';
    reply.log[level](
      { status, ms, ...(error ? { err: error } : {}) },
      `${request.method} ${request.url.split('?')[0]}`,
    );
  }
}

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    // Typed as Fastify's logger so routes keep the default instance type.
    loggerInstance: ctx.log.child({ component: 'http' }) as FastifyBaseLogger,
    logController: new QuietRequestLog(),
    // Live streams never finish on their own; without this, close() waits on
    // an open browser tab until Docker gives up and kills the process.
    forceCloseConnections: true,
  });

  await app.register(fastifyCookie);

  app.addHook('preHandler', async (request, reply) => {
    const path = request.url.split('?')[0] ?? '';
    if (!path.startsWith('/api/') || PUBLIC_PATHS.has(path)) return;
    if (!ctx.crypto.verifySession(request.cookies[SESSION_COOKIE])) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }
  });

  app.setErrorHandler((err, request, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: 'Invalid request',
        details: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    }
    request.log.error({ err }, 'request failed');
    return reply.code(500).send({ error: 'Internal error' });
  });

  await authRoutes(app, ctx);
  await rivianRoutes(app, ctx);
  await vehicleRoutes(app, ctx);
  await historyRoutes(app, ctx);
  await chargingRoutes(app, ctx);
  await settingsRoutes(app, ctx);
  await locationRoutes(app, ctx);
  await healthRoutes(app, ctx);
  await notificationRoutes(app, ctx);

  if (ctx.config.WEB_DIST && existsSync(ctx.config.WEB_DIST)) {
    await app.register(fastifyStatic, { root: ctx.config.WEB_DIST });
    app.setNotFoundHandler((request, reply) => {
      const path = request.url.split('?')[0] ?? '';
      if (
        request.method === 'GET' &&
        !path.startsWith('/api/') &&
        !path.startsWith('/assets/') &&
        !ASSET_PATH_PATTERN.test(path)
      ) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'Not found' });
    });
  }

  return app;
}
