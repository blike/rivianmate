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
