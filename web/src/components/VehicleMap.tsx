import type { FeatureCollection } from "geojson";
import type { GeoJSONSource, LngLatBoundsLike, Map as MapLibreMap, Marker } from "maplibre-gl";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMapConfig } from "../api/hooks.js";
import { loadMaplibre } from "../lib/maplibre.js";
import { DEFAULT_BASEMAP, MAP_THEME, themedStyle } from "../lib/mapStyle.js";

export const MAP_HEIGHT = "20rem";

const ROUTE = "route";
const ROUTE_START = "route-start";
const ROUTE_HOVER = "route-hover";
const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

/** Puck with a heading arrow and a soft pulse; rotation is applied by MapLibre. */
function vehicleElement(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "rm-vehicle";
  el.setAttribute("aria-label", "Vehicle location");
  el.innerHTML = `
    <span class="rm-vehicle__pulse"></span>
    <span class="rm-vehicle__puck">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 18.5 19 12 15.6 5.5 19Z"/></svg>
    </span>`;
  return el;
}

/** History uses a uniform trail; individual routes retain direction and endpoints. */
function addRouteLayers(map: MapLibreMap, history: boolean) {
  map.addSource(ROUTE, { type: "geojson", data: EMPTY, lineMetrics: true });
  map.addSource(ROUTE_START, { type: "geojson", data: EMPTY });
  map.addLayer({
    id: "route-glow",
    type: "line",
    source: ROUTE,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": MAP_THEME.accent,
      "line-width": ["interpolate", ["linear"], ["zoom"], 8, 6, 16, 16],
      "line-blur": ["interpolate", ["linear"], ["zoom"], 8, 4, 16, 10],
      "line-opacity": 0.22,
    },
  });
  map.addLayer({
    id: "route-line",
    type: "line",
    source: ROUTE,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-width": ["interpolate", ["linear"], ["zoom"], 8, 2, 16, 4.5],
      ...(history ? { "line-color": MAP_THEME.accent } : {
        "line-gradient": [
          "interpolate", ["linear"], ["line-progress"],
          0, MAP_THEME.accentDim,
          1, MAP_THEME.accent,
        ],
      }),
    },
  });
  map.addSource(ROUTE_HOVER, { type: "geojson", data: EMPTY });
  map.addLayer({
    id: "route-start",
    type: "circle",
    source: ROUTE_START,
    paint: {
      "circle-radius": history ? 3 : 5,
      "circle-color": history ? MAP_THEME.accent : MAP_THEME.background,
      "circle-stroke-color": MAP_THEME.accentDim,
      "circle-stroke-width": history ? 0 : 2.5,
    },
  });
  map.addLayer({
    id: "route-hover-halo",
    type: "circle",
    source: ROUTE_HOVER,
    paint: { "circle-radius": 13, "circle-color": MAP_THEME.accent, "circle-opacity": 0.2, "circle-blur": 0.4 },
  });
  map.addLayer({
    id: "route-hover",
    type: "circle",
    source: ROUTE_HOVER,
    paint: {
      "circle-radius": 5.5,
      "circle-color": "#ffffff",
      "circle-stroke-color": MAP_THEME.accent,
      "circle-stroke-width": 2.5,
    },
  });
}

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

export function VehicleMap(props: {
  lat: number;
  lon: number;
  bearing?: number | null;
  trail?: [number, number][];
  height?: string;
  follow?: boolean;
  /** History is an overview: no endpoint markers or time-based fade. */
  variant?: "vehicle" | "history";
  /** The position is out of date (no GPS fix since). */
  stale?: boolean;
  /** [lat, lon] to mark on the route, e.g. the point hovered on a chart. */
  highlight?: [number, number] | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const [ready, setReady] = useState(false);
  const { data: mapConfig } = useMapConfig();

  // The latest props, readable from the one-time map setup below.
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });

  // Create the map once the basemap config is known.
  useEffect(() => {
    const container = containerRef.current;
    if (!mapConfig || !container) return;
    let cancelled = false;
    let map: MapLibreMap | undefined;
    let observer: ResizeObserver | undefined;

    void loadMaplibre().then((maplibre) => {
      if (cancelled) return;
      const { lat, lon, trail, follow } = latest.current;
      // A fixed route starts framed, rather than at the vehicle and then jumping out.
      const bounds = follow === false ? routeBounds(trail) : null;
      map = new maplibre.Map({
        container,
        style:
          mapConfig.styleUrl ??
          themedStyle({
            tilesUrl: mapConfig.tilesUrl ?? DEFAULT_BASEMAP.tilesUrl,
            glyphsUrl: mapConfig.glyphsUrl ?? DEFAULT_BASEMAP.glyphsUrl,
          }),
        ...(bounds ? { bounds, fitBoundsOptions: FIT } : { center: [lon, lat] as [number, number], zoom: 14 }),
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
      });
      map.touchZoomRotate.disableRotation();
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
      map.addControl(new maplibre.AttributionControl({ compact: true }), "bottom-right");
      if (latest.current.variant !== "history") {
        markerRef.current = new maplibre.Marker({ element: vehicleElement(), rotationAlignment: "map" })
          .setLngLat([lon, lat])
          .addTo(map);
      }
      map.on("load", () => {
        if (!map) return;
        addRouteLayers(map, latest.current.variant === "history");
        setReady(true);
      });
      // Until the viewer pans or zooms, a route stays framed as its panel resizes.
      let moved = false;
      map.on("movestart", (e) => {
        if (e.originalEvent) moved = true;
      });
      // MapLibre only tracks window resizes; panels resize on their own too.
      observer = new ResizeObserver(() => {
        if (!map) return;
        map.resize();
        const route = latest.current.follow === false ? routeBounds(latest.current.trail) : null;
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
    };
  }, [mapConfig]);

  // Vehicle position and heading; follow it unless showing a fixed route.
  useEffect(() => {
    const marker = markerRef.current;
    const map = mapRef.current;
    if (!marker || !map) return;
    marker.setLngLat([props.lon, props.lat]);
    marker.getElement().classList.toggle("rm-vehicle--stale", props.stale === true);
    const hasHeading = props.bearing != null;
    marker.getElement().classList.toggle("rm-vehicle--heading", hasHeading);
    marker.setRotation(props.bearing ?? 0);
    if (props.follow !== false) map.easeTo({ center: [props.lon, props.lat], duration: 800 });
  }, [props.lat, props.lon, props.bearing, props.follow, props.stale, ready]);

  // Route data, framed to fit when it isn't following the vehicle.
  const trail = props.trail;
  const trailKey = trail ? `${trail.length}|${trail[0]}|${trail.at(-1)}` : "";
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const coords = (latest.current.trail ?? []).map(toLngLat);
    const line: FeatureCollection =
      coords.length > 1
        ? {
            type: "FeatureCollection",
            features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } }],
          }
        : EMPTY;
    // A single history position gets a neutral dot; longer trails have no endpoints.
    const start: FeatureCollection =
      (latest.current.variant === "history" ? coords.length === 1 : coords.length > 1)
        ? {
            type: "FeatureCollection",
            features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: coords[0]! } }],
          }
        : EMPTY;
    (map.getSource(ROUTE) as GeoJSONSource | undefined)?.setData(line);
    (map.getSource(ROUTE_START) as GeoJSONSource | undefined)?.setData(start);
    const route = latest.current.follow === false ? routeBounds(latest.current.trail) : null;
    if (route) map.fitBounds(route, { ...FIT, duration: 0 });
    else if (latest.current.variant === "history" && coords.length === 1) map.jumpTo({ center: coords[0]!, zoom: 14 });
  }, [trailKey, ready]);

  // A marked point on the route, moved without re-framing the map.
  const [hoverLat, hoverLon] = props.highlight ?? [null, null];
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource(ROUTE_HOVER) as GeoJSONSource | undefined)?.setData(
      hoverLat != null && hoverLon != null
        ? {
            type: "FeatureCollection",
            features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [hoverLon, hoverLat] } }],
          }
        : EMPTY,
    );
  }, [hoverLat, hoverLon, ready]);

  return (
    <div
      ref={containerRef}
      className="rm-map"
      style={{ height: props.height ?? MAP_HEIGHT, width: "100%" }}
    />
  );
}
