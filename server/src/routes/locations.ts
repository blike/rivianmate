import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { GeocodeResultDto, SavedLocation } from '../api-types.js';
import type { AppContext } from '../context.js';
import { savedLocations } from '../db/schema.js';
import { MAX_RADIUS_M, MIN_RADIUS_M } from '../services/locations.js';

const locationSchema = z.object({
  name: z.string().trim().min(1).max(40),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  radiusM: z.number().int().min(MIN_RADIUS_M).max(MAX_RADIUS_M),
  isHome: z.boolean(),
  ratePerKwh: z.number().min(0).max(10).nullable(),
});

const idParams = z.object({ id: z.coerce.number().int().positive() });

function toLocation(row: typeof savedLocations.$inferSelect): SavedLocation {
  const { createdAt: _createdAt, ...location } = row;
  return location;
}

export async function loadLocations(ctx: Pick<AppContext, 'db'>): Promise<SavedLocation[]> {
  const rows = await ctx.db.select().from(savedLocations).orderBy(asc(savedLocations.id));
  return rows.map(toLocation);
}

export async function locationRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/api/locations', async (): Promise<SavedLocation[]> => loadLocations(ctx));

  app.post('/api/locations', async (request, reply): Promise<SavedLocation> => {
    const input = locationSchema.parse(request.body);
    const [row] = await ctx.db.insert(savedLocations).values(input).returning();
    ctx.notifications.placesChanged();
    reply.code(201);
    return toLocation(row!);
  });

  app.put('/api/locations/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const input = locationSchema.parse(request.body);
    const [row] = await ctx.db
      .update(savedLocations)
      .set(input)
      .where(eq(savedLocations.id, id))
      .returning();
    if (!row) return reply.code(404).send({ error: 'Location not found' });
    ctx.notifications.placesChanged();
    return toLocation(row);
  });

  app.delete('/api/locations/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const deleted = await ctx.db
      .delete(savedLocations)
      .where(eq(savedLocations.id, id))
      .returning({ id: savedLocations.id });
    if (deleted.length === 0) return reply.code(404).send({ error: 'Location not found' });
    ctx.notifications.placesChanged();
    return reply.code(204).send();
  });

  app.get('/api/geocode/search', async (request, reply): Promise<GeocodeResultDto[]> => {
    const { q, lat, lon } = z
      .object({
        q: z.string().trim().min(3).max(200),
        lat: z.coerce.number().min(-90).max(90).optional(),
        lon: z.coerce.number().min(-180).max(180).optional(),
      })
      .parse(request.query);
    try {
      return await ctx.searchPlaces(q, lat != null && lon != null ? { lat, lon } : undefined);
    } catch (err) {
      request.log.warn({ err }, 'place search failed');
      return reply.code(502).send({ error: 'Search is unavailable right now' });
    }
  });
}
