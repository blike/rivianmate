/** Coordinates the feeds and the services share. */

/**
 * A real position: finite, in range, and not 0,0. It lives here, rather than
 * beside the vehicle state, because a Parallax domain reads it too and must
 * not reach into the services.
 */
export function isPosition(lat: unknown, lon: unknown): boolean {
  if (typeof lat !== 'number' || typeof lon !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;
  return Math.abs(lat) > 1e-4 || Math.abs(lon) > 1e-4;
}
