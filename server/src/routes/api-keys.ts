import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ApiKeyDto, CreatedApiKeyDto } from '../api-types.js';
import type { AppContext } from '../context.js';
import { ApiKeyLimitError } from '../services/api-keys.js';

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  scope: z.literal('read').optional(),
  expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
});

const idParams = z.object({ id: z.coerce.number().int().positive() });

export async function apiKeyRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/api/api-keys', async (): Promise<ApiKeyDto[]> => ctx.apiKeys.list());

  app.post('/api/api-keys', async (request, reply): Promise<CreatedApiKeyDto | void> => {
    const body = createSchema.parse(request.body);
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      return reply.code(400).send({ error: 'Expiration must be in the future' });
    }
    try {
      const created = await ctx.apiKeys.create({
        name: body.name,
        expiresAt,
      });
      return reply.code(201).send(created);
    } catch (err) {
      if (err instanceof ApiKeyLimitError) {
        return reply.code(409).send({ error: err.message });
      }
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>('/api/api-keys/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const removed = await ctx.apiKeys.revoke(id);
    if (!removed) return reply.code(404).send({ error: 'API key not found' });
    return reply.code(204).send();
  });
}
