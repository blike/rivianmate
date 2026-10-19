import { z } from 'zod';

/**
 * An optional window for listings: without one, the newest LIST_LIMIT;
 * with one, everything that started in it, up to WINDOW_LIMIT.
 */
export const listWindowSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export const LIST_LIMIT = 200;
export const WINDOW_LIMIT = 5000;

/** How many rows a listing returns, with or without a window. */
export const listLimit = (q: { from?: Date; to?: Date }) =>
  q.from || q.to ? WINDOW_LIMIT : LIST_LIMIT;
