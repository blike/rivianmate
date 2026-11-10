import { z } from 'zod';
import { LIST_LIMIT, afterStart } from '../list-page.js';

export { LIST_LIMIT, afterStart };

/**
 * An optional window for listings: without one, the newest LIST_LIMIT, or
 * with `before`, the LIST_LIMIT that started before it (the next page), or
 * with `after`, the LIST_LIMIT that started after it (the page above a list
 * that was opened part way back); with one, everything that started in it.
 * Either way the newest come first.
 */
export const listWindowSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  before: z.coerce.date().optional(),
  after: z.coerce.date().optional(),
});

/** How many rows a listing returns: a page without a window, and with one, all of them. */
export const listLimit = (q: { from?: Date; to?: Date }): number | undefined =>
  q.from || q.to ? undefined : LIST_LIMIT;
