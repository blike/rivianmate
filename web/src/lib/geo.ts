/** Great-circle distance in km. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(r(lat2 - lat1) / 2) ** 2 +
    Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

/** Points with cumulative distance (km) from the first point. */
export function withCumulativeKm<T extends { lat: number; lon: number }>(
  points: readonly T[],
): (T & { km: number })[] {
  let km = 0;
  return points.map((p, i) => {
    const prev = points[i - 1];
    if (prev) km += haversineKm(prev.lat, prev.lon, p.lat, p.lon);
    return { ...p, km };
  });
}

/** A real position: finite, in range, and not the 0,0 Rivian sends without a fix. */
export function isPosition(lat: unknown, lon: unknown): lat is number {
  if (typeof lat !== 'number' || typeof lon !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;
  return Math.abs(lat) > 1e-4 || Math.abs(lon) > 1e-4;
}

const EARTH_RADIUS_M = 6_371_000;

/** A circle on the map as a closed ring of [lon, lat] points. */
export function circlePolygon(
  lat: number,
  lon: number,
  radiusM: number,
  steps = 64,
): [number, number][] {
  const r = (deg: number) => (deg * Math.PI) / 180;
  const deg = (rad: number) => (rad * 180) / Math.PI;
  const d = radiusM / EARTH_RADIUS_M;
  const lat1 = r(lat);
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const bearing = (2 * Math.PI * (i % steps)) / steps;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing),
    );
    const dLon = Math.atan2(
      Math.sin(bearing) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
    ring.push([lon + deg(dLon), deg(lat2)]);
  }
  return ring;
}
