import { z } from 'zod';
import { LIST_LIMIT } from '../list-page.js';

export { LIST_LIMIT };

/**
 * An optional window for listings: without one, the newest LIST_LIMIT, or
 * with `before`, the LIST_LIMIT that started before it (the next page);
 * with one, everything that started in it, up to WINDOW_LIMIT.
 */
export const listWindowSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  before: z.coerce.date().optional(),
});
export const WINDOW_LIMIT = 5000;

/** How many rows a listing returns, with or without a window. */
export const listLimit = (q: { from?: Date; to?: Date }) =>
  q.from || q.to ? WINDOW_LIMIT : LIST_LIMIT;
