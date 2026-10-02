import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

/**
 * Loads MapLibre on demand (it's large, and only map pages need it).
 * MapLibre resolves its worker with a non-literal `new URL(…, import.meta.url)`,
 * which bundlers can't follow, so point it at a worker Vite bundles itself.
 */
export async function loadMaplibre() {
  const maplibre = await import("maplibre-gl");
  maplibre.setWorkerUrl(workerUrl);
  return maplibre;
}
