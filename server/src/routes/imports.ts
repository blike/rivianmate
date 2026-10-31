import type { FastifyInstance } from 'fastify';
import type { Readable } from 'node:stream';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { ImportError } from '../services/electrafi/imports.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const selectionSchema = z.object({
  draftId: z.string().min(1).max(64),
  vehicleId: z.string().min(1).max(200),
  timeZone: z.string().min(1).max(100),
  from: isoDate,
  to: isoDate,
});
const uploadQuery = z.object({
  draft: z.string().min(1).max(64).optional(),
  name: z.string().max(1000).default('export.csv'),
});

export async function importRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // Exports run to hundreds of megabytes, so uploads are handed over as a
  // stream, read only once the route runs, after the auth check.
  app.addContentTypeParser('application/octet-stream', (_request, payload, done) => {
    done(null, payload);
  });

  /** Answers with what the user can act on; anything else is a server error. */
  app.setErrorHandler((err, request, reply) => {
    if (err instanceof ImportError) return reply.code(err.status).send({ error: err.message });
    if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Invalid request' });
    // Fastify's own refusals, such as a body type this route doesn't take.
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status < 500) return reply.code(status).send({ error: (err as Error).message });
    request.log.error({ err }, 'request failed');
    return reply.code(500).send({ error: 'Internal error' });
  });

  app.get('/api/imports', async () => ctx.imports.list());

  app.post('/api/imports/files', async (request) => {
    const { draft, name } = uploadQuery.parse(request.query);
    if (request.headers['content-type'] !== 'application/octet-stream') {
      throw new ImportError('Upload the file as a binary body.', 415);
    }
    return ctx.imports.addFile(draft, name, request.body as Readable);
  });

  app.delete<{ Params: { id: string } }>('/api/imports/drafts/:id', async (request, reply) => {
    await ctx.imports.discardDraft(request.params.id);
    return reply.code(204).send();
  });

  app.post('/api/imports/preview', async (request) => {
    const { draftId, ...selection } = selectionSchema.parse(request.body);
    return ctx.imports.preview(draftId, selection);
  });

  app.post('/api/imports', async (request, reply) => {
    const { draftId, ...selection } = selectionSchema.parse(request.body);
    return reply.code(202).send(await ctx.imports.start(draftId, selection));
  });

  app.delete<{ Params: { id: string } }>('/api/imports/:id', async (request, reply) => {
    const id = z.coerce.number().int().positive().parse(request.params.id);
    await ctx.imports.undo(id);
    return reply.code(204).send();
  });
}
