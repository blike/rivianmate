import type { Feature, FeatureCollection, Polygon } from 'geojson';
import type { GeoJSONSource, LngLatBoundsLike, Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { circlePolygon, haversineKm } from '../lib/geo';
import { loadMaplibre } from '../lib/maplibre';
import { MAP_THEME, themedStyle } from '../lib/mapStyle';

const AREA = 'area';
const OTHERS = 'others';
/** Moves smaller than this don't count as a new center (map rounding). */
const SAME_SPOT_KM = 0.001;

export interface PickerArea {
  lat: number;
  lon: number;
  radiusM: number;
}

const circle = (a: PickerArea): Feature<Polygon> => ({
  type: 'Feature',
  properties: {},
  geometry: { type: 'Polygon', coordinates: [circlePolygon(a.lat, a.lon, a.radiusM)] },
});

const collection = (areas: readonly PickerArea[]): FeatureCollection => ({
  type: 'FeatureCollection',
  features: areas.map(circle),
});

function bounds(a: PickerArea): LngLatBoundsLike {
  const ring = circlePolygon(a.lat, a.lon, a.radiusM, 16);
  const lons = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
}

const FIT = { padding: 48, maxZoom: 18 };

/**
 * Picks a location's area: the map moves under a pin fixed at its center,
 * and the circle shows how far the area reaches. Other saved areas are drawn
 * faintly, so overlaps show.
 */
export function LocationPicker(props: {
  area: PickerArea;
  others: readonly PickerArea[];
  onMove: (lat: number, lon: number) => void;
  height?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);

  // The latest props, readable from the one-time map setup below.
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let map: MapLibreMap | undefined;
    let observer: ResizeObserver | undefined;

    void loadMaplibre().then((maplibre) => {
      if (cancelled) return;
      map = new maplibre.Map({
        container,
        style: themedStyle(),
        bounds: bounds(latest.current.area),
        fitBoundsOptions: FIT,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
      });
      map.touchZoomRotate.disableRotation();
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
      map.addControl(new maplibre.AttributionControl({ compact: true }), 'bottom-right');
      map.on('load', () => {
        if (!map) return;
        map.addSource(OTHERS, { type: 'geojson', data: collection(latest.current.others) });
        map.addSource(AREA, { type: 'geojson', data: collection([latest.current.area]) });
        map.addLayer({
          id: 'others-fill',
          type: 'fill',
          source: OTHERS,
          paint: { 'fill-color': MAP_THEME.accentDim, 'fill-opacity': 0.12 },
        });
        map.addLayer({
          id: 'others-line',
          type: 'line',
          source: OTHERS,
          paint: { 'line-color': MAP_THEME.accentDim, 'line-width': 1, 'line-dasharray': [2, 2] },
        });
        map.addLayer({
          id: 'area-fill',
          type: 'fill',
          source: AREA,
          paint: { 'fill-color': MAP_THEME.accent, 'fill-opacity': 0.14 },
        });
        map.addLayer({
          id: 'area-line',
          type: 'line',
          source: AREA,
          paint: { 'line-color': MAP_THEME.accent, 'line-width': 2 },
        });
        setReady(true);
      });
      // The circle follows the pin while dragging; the new center is
      // reported once the map settles.
      map.on('move', () => {
        if (!map) return;
        const c = map.getCenter();
        (map.getSource(AREA) as GeoJSONSource | undefined)?.setData(
          collection([{ ...latest.current.area, lat: c.lat, lon: c.lng }]),
        );
      });
      map.on('moveend', () => {
        if (!map) return;
        const c = map.getCenter();
        const { lat, lon } = latest.current.area;
        if (haversineKm(lat, lon, c.lat, c.lng) > SAME_SPOT_KM) latest.current.onMove(c.lat, c.lng);
      });
      observer = new ResizeObserver(() => map?.resize());
      observer.observe(container);
      mapRef.current = map;
    });

    return () => {
      cancelled = true;
      observer?.disconnect();
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // A center set from outside (a search result, the vehicle) moves the map.
  const { lat, lon, radiusM } = props.area;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const c = map.getCenter();
    if (haversineKm(lat, lon, c.lat, c.lng) > SAME_SPOT_KM) {
      map.fitBounds(bounds(latest.current.area), { ...FIT, duration: 600 });
    }
  }, [lat, lon, ready]);

  // Resizing redraws the circle, and zooms out if it no longer fits.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const c = map.getCenter();
    const area = { lat: c.lat, lon: c.lng, radiusM };
    (map.getSource(AREA) as GeoJSONSource | undefined)?.setData(collection([area]));
    const view = map.getBounds();
    const [[west, south], [east, north]] = bounds(area) as [[number, number], [number, number]];
    if (!view.contains([west, south]) || !view.contains([east, north])) {
      map.fitBounds(bounds(area), { ...FIT, duration: 300 });
    }
  }, [radiusM, ready]);

  const othersKey = props.others.map((o) => `${o.lat},${o.lon},${o.radiusM}`).join('|');
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource(OTHERS) as GeoJSONSource | undefined)?.setData(
      collection(latest.current.others),
    );
  }, [othersKey, ready]);

  return (
    <div className="rm-map" style={{ height: props.height ?? '18rem', width: '100%' }}>
      {/* Inline, since MapLibre's own stylesheet makes its container relative. */}
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      <span aria-hidden className="rm-pin" />
    </div>
  );
}
