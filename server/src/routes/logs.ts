import type { FastifyInstance } from 'fastify';
import type { LogBacklogDto } from '../api-types.js';
import type { AppContext } from '../context.js';

export async function logRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  /** SSE: recent lines since startup, then each new line as it's logged. */
  app.get('/api/logs/stream', async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(':ok\n\n');

    // Nothing in here may log: each line would be streamed and logged again.
    const send = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const backlog: LogBacklogDto = { level: ctx.config.LOG_LEVEL, entries: ctx.logs.recent() };
    send('backlog', backlog);
    const off = ctx.logs.onEntry((entry) => send('log', entry));
    const keepalive = setInterval(() => reply.raw.write(':ka\n\n'), 25_000);

    request.raw.on('close', () => {
      off();
      clearInterval(keepalive);
    });
  });
}
