import type { FeatureCollection } from 'geojson';
import type { GeoJSONSource, LngLatBoundsLike, Map as MapLibreMap, Marker } from 'maplibre-gl';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { loadMaplibre } from '../lib/maplibre';
import { MAP_THEME, themedStyle } from '../lib/mapStyle';

export const MAP_HEIGHT = '20rem';

const ROUTE = 'route';
const ROUTE_START = 'route-start';
const ROUTE_HOVER = 'route-hover';
const PLAN = 'plan';
const PLAN_END = 'plan-end';
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Puck with a heading arrow and a soft pulse; rotation is applied by MapLibre. */
/** A numbered stop on the planned route, as on the drive's bar. */
function stopElement(number: number, name: string | null): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'rm-stop';
  el.textContent = String(number);
  if (name) el.title = name;
  return el;
}

function vehicleElement(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'rm-vehicle';
  el.setAttribute('aria-label', 'Vehicle location');
  el.innerHTML = `
    <span class="rm-vehicle__pulse"></span>
    <span class="rm-vehicle__puck">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 18.5 19 12 15.6 5.5 19Z"/></svg>
    </span>`;
  return el;
}

/** History uses a uniform trail; individual routes retain direction and endpoints. */
function addRouteLayers(map: MapLibreMap, history: boolean) {
  // Navigation's planned route, dashed beneath the driven one.
  map.addSource(PLAN, { type: 'geojson', data: EMPTY });
  map.addSource(PLAN_END, { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: 'plan-line',
    type: 'line',
    source: PLAN,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': MAP_THEME.accent,
      'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2, 16, 4],
      'line-opacity': 0.65,
      'line-dasharray': [1.5, 2],
    },
  });
  map.addLayer({
    id: 'plan-end',
    type: 'circle',
    source: PLAN_END,
    paint: {
      'circle-radius': 6,
      'circle-color': MAP_THEME.background,
      'circle-stroke-color': MAP_THEME.accent,
      'circle-stroke-width': 3,
    },
  });
  map.addSource(ROUTE, { type: 'geojson', data: EMPTY, lineMetrics: true });
  map.addSource(ROUTE_START, { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: 'route-glow',
    type: 'line',
    source: ROUTE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': MAP_THEME.accent,
      'line-width': ['interpolate', ['linear'], ['zoom'], 8, 6, 16, 16],
      'line-blur': ['interpolate', ['linear'], ['zoom'], 8, 4, 16, 10],
      // History is drawn faint, so a road builds up the more trips cover it.
      'line-opacity': history ? 0.05 : 0.22,
    },
  });
  map.addLayer({
    id: 'route-line',
    type: 'line',
    source: ROUTE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2, 16, 4.5],
      ...(history
        ? { 'line-color': MAP_THEME.accent, 'line-opacity': HISTORY_TRIP_OPACITY }
        : {
            'line-gradient': [
              'interpolate',
              ['linear'],
              ['line-progress'],
              0,
              MAP_THEME.accentDim,
              1,
              MAP_THEME.accent,
            ],
          }),
    },
  });
  map.addSource(ROUTE_HOVER, { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: 'route-start',
    type: 'circle',
    source: ROUTE_START,
    paint: {
      'circle-radius': history ? 3 : 5,
      'circle-color': history ? MAP_THEME.accent : MAP_THEME.background,
      'circle-stroke-color': MAP_THEME.accentDim,
      'circle-stroke-width': history ? 0 : 2.5,
    },
  });
  map.addLayer({
    id: 'route-hover-halo',
    type: 'circle',
    source: ROUTE_HOVER,
    paint: {
      'circle-radius': 13,
      'circle-color': MAP_THEME.accent,
      'circle-opacity': 0.2,
      'circle-blur': 0.4,
    },
  });
  map.addLayer({
    id: 'route-hover',
    type: 'circle',
    source: ROUTE_HOVER,
    paint: {
      'circle-radius': 5.5,
      'circle-color': '#ffffff',
      'circle-stroke-color': MAP_THEME.accent,
      'circle-stroke-width': 2.5,
    },
  });
}

/**
 * One trip's line in the history view. Trips are separate lines, so where
 * they overlap the opacity compounds: about 0.3 for one trip, 0.75 for
 * four, nearly solid past eight.
 */
const HISTORY_TRIP_OPACITY = 0.3;

/** For a legend beside the map: one trip to many. */
export const TRIPS_LEGEND = `linear-gradient(90deg, color-mix(in srgb, ${MAP_THEME.accent} 30%, transparent), ${MAP_THEME.accent})`;

/** [lat, lon] pairs → GeoJSON [lon, lat]. */
const toLngLat = (p: [number, number]): [number, number] => [p[1], p[0]];

const FIT = { padding: 48, maxZoom: 16 };

/** The box around a route, or null when there isn't one to frame. */
function routeBounds(trail: [number, number][] | undefined): LngLatBoundsLike | null {
  if (!trail || trail.length < 2) return null;
  const lats = trail.map((p) => p[0]);
  const lons = trail.map((p) => p[1]);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
}

/** Navigation's planned route and destination, as [lat, lon]. */
type Plan = {
  route: [number, number][] | null;
  /** With stops on the way, every stop to number, the destination last. */
  stops?: { at: [number, number]; name: string | null }[];
  destination: [number, number];
};

/** A fixed route's frame: the driven trail, plus where navigation plans to go. */
function framing(props: {
  follow?: boolean;
  trail?: [number, number][];
  trips?: [number, number][][];
  plan?: Plan | null;
}): LngLatBoundsLike | null {
  if (props.follow !== false) return null;
  const plan = props.plan ? (props.plan.route ?? [props.plan.destination]) : [];
  return routeBounds([...(props.trail ?? []), ...(props.trips ?? []).flat(), ...plan]);
}

export function VehicleMap(props: {
  lat: number;
  lon: number;
  bearing?: number | null;
  trail?: [number, number][];
  /** Separate trips, as [lat, lon] lines; in place of `trail`. */
  trips?: [number, number][][];
  height?: string;
  follow?: boolean;
  /** History is an overview: no endpoint markers or time-based fade. */
  variant?: 'vehicle' | 'history';
  /** The position is out of date (no GPS fix since). */
  stale?: boolean;
  /** [lat, lon] to mark on the route, e.g. the point hovered on a chart. */
  highlight?: [number, number] | null;
  /** Navigation's planned route, stops and destination. */
  plan?: Plan | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const stopMarkersRef = useRef<Marker[]>([]);
  const maplibreRef = useRef<Awaited<ReturnType<typeof loadMaplibre>> | null>(null);
  const [ready, setReady] = useState(false);

  // The latest props, readable from the one-time map setup below.
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });

  // Create the map once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let map: MapLibreMap | undefined;
    let observer: ResizeObserver | undefined;

    void loadMaplibre().then((maplibre) => {
      if (cancelled) return;
      maplibreRef.current = maplibre;
      const { lat, lon } = latest.current;
      // A fixed route starts framed, rather than at the vehicle and then jumping out.
      const bounds = framing(latest.current);
      map = new maplibre.Map({
        container,
        style: themedStyle(),
        ...(bounds
          ? { bounds, fitBoundsOptions: FIT }
          : { center: [lon, lat] as [number, number], zoom: 14 }),
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
      });
      map.touchZoomRotate.disableRotation();
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
      map.addControl(new maplibre.AttributionControl({ compact: true }), 'bottom-right');
      if (latest.current.variant !== 'history') {
        markerRef.current = new maplibre.Marker({
          element: vehicleElement(),
          rotationAlignment: 'map',
        })
          .setLngLat([lon, lat])
          .addTo(map);
      }
      map.on('load', () => {
        if (!map) return;
        addRouteLayers(map, latest.current.variant === 'history');
        setReady(true);
      });
      // Until the viewer pans or zooms, a route stays framed as its panel resizes.
      let moved = false;
      map.on('movestart', (e) => {
        if (e.originalEvent) moved = true;
      });
      // MapLibre only tracks window resizes; panels resize on their own too.
      observer = new ResizeObserver(() => {
        if (!map) return;
        map.resize();
        const route = framing(latest.current);
        if (route && !moved) map.fitBounds(route, { ...FIT, duration: 0 });
      });
      observer.observe(container);
      mapRef.current = map;
    });

    return () => {
      cancelled = true;
      observer?.disconnect();
      map?.remove();
      mapRef.current = null;
      markerRef.current = null;
      stopMarkersRef.current = [];
    };
  }, []);

  // Vehicle position and heading; follow it unless showing a fixed route.
  useEffect(() => {
    const marker = markerRef.current;
    const map = mapRef.current;
    if (!marker || !map) return;
    marker.setLngLat([props.lon, props.lat]);
    marker.getElement().classList.toggle('rm-vehicle--stale', props.stale === true);
    const hasHeading = props.bearing != null;
    marker.getElement().classList.toggle('rm-vehicle--heading', hasHeading);
    marker.setRotation(props.bearing ?? 0);
    if (props.follow !== false) map.easeTo({ center: [props.lon, props.lat], duration: 800 });
  }, [props.lat, props.lon, props.bearing, props.follow, props.stale, ready]);

  // Route data, framed to fit when it isn't following the vehicle.
  const trail = props.trail;
  const trips = props.trips;
  const trailKey = trips
    ? `trips|${trips.length}|${trips.reduce((n, t) => n + t.length, 0)}|${trips.at(-1)?.at(-1)}`
    : trail
      ? `${trail.length}|${trail[0]}|${trail.at(-1)}`
      : '';
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const coords = (latest.current.trail ?? []).map(toLngLat);
    const tripLines = latest.current.trips?.filter((t) => t.length > 1);
    const line: FeatureCollection = tripLines
      ? {
          type: 'FeatureCollection',
          features: tripLines.map((t) => ({
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: t.map(toLngLat) },
          })),
        }
      : coords.length > 1
        ? {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: {},
                geometry: { type: 'LineString', coordinates: coords },
              },
            ],
          }
        : EMPTY;
    // A single history position gets a neutral dot; longer trails have no endpoints.
    const start: FeatureCollection = (
      latest.current.variant === 'history' ? coords.length === 1 : coords.length > 1
    )
      ? {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: {},
              geometry: { type: 'Point', coordinates: coords[0]! },
            },
          ],
        }
      : EMPTY;
    (map.getSource(ROUTE) as GeoJSONSource | undefined)?.setData(line);
    (map.getSource(ROUTE_START) as GeoJSONSource | undefined)?.setData(start);
    const route = framing(latest.current);
    if (route) map.fitBounds(route, { ...FIT, duration: 0 });
    else if (latest.current.variant === 'history' && coords.length === 1)
      map.jumpTo({ center: coords[0]!, zoom: 14 });
  }, [trailKey, ready]);

  // A marked point on the route, moved without re-framing the map.
  const [hoverLat, hoverLon] = props.highlight ?? [null, null];
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource(ROUTE_HOVER) as GeoJSONSource | undefined)?.setData(
      hoverLat != null && hoverLon != null
        ? {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: {},
                geometry: { type: 'Point', coordinates: [hoverLon, hoverLat] },
              },
            ],
          }
        : EMPTY,
    );
  }, [hoverLat, hoverLon, ready]);

  // The planned route, redrawn when navigation recalculates it.
  const plan = props.plan;
  const planKey = plan
    ? `${plan.destination}|${plan.stops?.map((s) => `${s.at}:${s.name}`).join(';')}|${plan.route?.length}|${plan.route?.[0]}|${plan.route?.at(-1)}`
    : '';
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const p = latest.current.plan;
    const points = (at: [number, number][]): FeatureCollection => ({
      type: 'FeatureCollection',
      features: at.map((p) => ({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Point', coordinates: toLngLat(p) },
      })),
    });
    (map.getSource(PLAN) as GeoJSONSource | undefined)?.setData(
      p?.route && p.route.length > 1
        ? {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: {},
                geometry: { type: 'LineString', coordinates: p.route.map(toLngLat) },
              },
            ],
          }
        : EMPTY,
    );
    // Numbered stops take the destination's place, so it isn't marked twice.
    const stops = p?.stops ?? [];
    (map.getSource(PLAN_END) as GeoJSONSource | undefined)?.setData(
      p && stops.length === 0 ? points([p.destination]) : EMPTY,
    );
    for (const marker of stopMarkersRef.current) marker.remove();
    const maplibre = maplibreRef.current;
    stopMarkersRef.current = maplibre
      ? stops.map((stop, i) =>
          new maplibre.Marker({ element: stopElement(i + 1, stop.name) })
            .setLngLat(toLngLat(stop.at))
            .addTo(map),
        )
      : [];
    const route = framing(latest.current);
    if (route) map.fitBounds(route, { ...FIT, duration: 0 });
  }, [planKey, ready]);

  return (
    <div
      ref={containerRef}
      className="rm-map"
      style={{ height: props.height ?? MAP_HEIGHT, width: '100%' }}
    />
  );
}
