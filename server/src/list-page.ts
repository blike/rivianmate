/**
 * How many rows a listing without a window returns: the newest, or with
 * `before`, the next older page. Shared with the web app, which asks for
 * another page while the last one came back full.
 */
export const LIST_LIMIT = 200;

/**
 * The first instant a listing's `after` leaves in: the next millisecond.
 * Records are listed to the millisecond, so one listed at `after` but
 * stored to the microsecond (as TeslaMate's are) isn't read again.
 */
export const afterStart = (after: Date): Date => new Date(after.getTime() + 1);
