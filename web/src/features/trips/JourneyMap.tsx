import type { Feature, FeatureCollection } from 'geojson';
import type {
  ExpressionSpecification,
  GeoJSONSource,
  LngLatBoundsLike,
  Map as MapLibreMap,
  Marker,
  Popup,
} from 'maplibre-gl';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { loadMaplibre } from '../../lib/maplibre';
import { themedStyle } from '../../lib/mapStyle';
import {
  type JourneyLeg,
  type JourneyRoad,
  type JourneyStop,
  journeyRoads,
  replayFrame,
  stopPlaces,
} from './journey';

const LEGS = 'journey-legs';
const ROADS = 'journey-roads';
const REPLAY = 'journey-replay';
const ARROW = 'journey-arrow';
/** The rest of the journey, while a day or drive is picked or the replay runs. */
const QUIET_LINE = '#575d66';
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
/** Clear of the day picker above and the replay bar below, so no stop sits under them. */
const FIT = { padding: { top: 72, bottom: 104, left: 56, right: 56 }, maxZoom: 15 };

type Selection = { kind: 'drive' | 'charge' | 'stop'; id: number } | null;

const toLngLat = (p: [number, number]): [number, number] => [p[1], p[0]];

/** A line's width, from zoomed out to in. */
const width = (from: number, to: number): ExpressionSpecification => [
  'interpolate',
  ['linear'],
  ['zoom'],
  6,
  from,
  16,
  to,
];
/**
 * Half a line's width to the right of travel, so the way out and the way
 * back sit side by side on the same road, edge to edge.
 */
const OFFSET: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 6, 2, 16, 3];

function bounds(points: readonly [number, number][]): LngLatBoundsLike | null {
  if (points.length === 0) return null;
  let [minLat, minLon] = points[0]!;
  let [maxLat, maxLon] = points[0]!;
  for (const [lat, lon] of points) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ];
}

function arrowImage(): ImageData {
  const size = 16;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const c = canvas.getContext('2d')!;
  c.strokeStyle = '#ffffff';
  c.lineWidth = 2;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.beginPath();
  c.moveTo(5.5, 3.5);
  c.lineTo(10.5, 8);
  c.lineTo(5.5, 12.5);
  c.stroke();
  return c.getImageData(0, 0, size, size);
}

const roadFeatures = (roads: readonly JourneyRoad[]): FeatureCollection => ({
  type: 'FeatureCollection',
  features: roads.map((road, order): Feature => ({
    type: 'Feature',
    properties: {
      driveId: road.driveId,
      dayKey: road.dayKey,
      color: road.color,
      gap: road.gap,
      missing: road.missing,
      order,
    },
    geometry: { type: 'LineString', coordinates: road.points.map(toLngLat) },
  })),
});

const legFeatures = (legs: readonly JourneyLeg[]): FeatureCollection => ({
  type: 'FeatureCollection',
  features: legs.map((leg, order): Feature => ({
    type: 'Feature',
    properties: {
      driveId: leg.id,
      dayKey: leg.dayKey,
      color: leg.color,
      gap: leg.gap,
      order,
    },
    geometry: { type: 'LineString', coordinates: leg.points.map(toLngLat) },
  })),
});

function stopLabel(stops: readonly JourneyStop[]): string | null {
  const numbers = stops.flatMap((s) => (s.number != null ? [s.number] : []));
  if (numbers.length === 0) return null;
  return numbers.length > 2 ? `${numbers[0]}+` : numbers.join('·');
}

const FLAG = 'M5 21V4m0 0h11l-2 4 2 4H5';
const BOLT = 'M13 3 6 14h5l-1 7 7-11h-5Z';
const HOUSE = 'M4 11.5 12 5l8 6.5M6.5 9.5V19h11V9.5';
const MOON = 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z';

function icon(path: string, className: string, stroke = false): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  if (stroke) {
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '2.4');
    p.setAttribute('stroke-linejoin', 'round');
    p.setAttribute('stroke-linecap', 'round');
  } else {
    p.setAttribute('fill', 'currentColor');
  }
  svg.append(p);
  return svg;
}

function stopTitle(stop: JourneyStop): string {
  const place = stop.place ?? 'Unnamed place';
  if (stop.number != null) return `${stop.number}. ${place}`;
  const what = { start: 'Start', end: 'Finish', charge: 'Charge', stop: 'Stop' }[stop.kind];
  return `${what}: ${place}`;
}

/**
 * The marker's face sits inside a bare container: MapLibre positions the
 * container with a transform, so styling it (or scaling it on hover) would
 * pull the marker off its spot. Badges say what happened there, so it reads
 * without the color.
 */
function markerElement(stops: readonly JourneyStop[], onClick: () => void): HTMLDivElement {
  const root = document.createElement('div');
  const face = document.createElement('button');
  face.type = 'button';
  face.className = 'rm-journey-stop';
  const home = stops.some((s) => s.isHome);
  // Home is visited between outings on a long trip: one house, not a list of numbers.
  const label = home ? null : stopLabel(stops);
  const ends = stops.some((s) => s.kind === 'start' || s.kind === 'end');
  const charged = stops.some((s) => s.charges.length > 0);
  if (home) {
    face.classList.add('rm-journey-stop--end');
    face.append(icon(HOUSE, 'rm-journey-stop__icon', true));
  } else if (label) {
    const text = document.createElement('span');
    text.textContent = label;
    face.append(text);
  } else if (ends) {
    face.classList.add('rm-journey-stop--end');
    face.append(icon(FLAG, 'rm-journey-stop__icon', true));
  } else {
    face.append(icon(BOLT, 'rm-journey-stop__icon'));
  }
  face.setAttribute('aria-label', stops.map(stopTitle).join(', '));
  if (charged && (label || ends || home)) {
    face.append(icon(BOLT, 'rm-journey-stop__badge rm-journey-stop__badge--charge'));
  }
  if (stops.some((s) => s.nights > 0)) {
    face.append(icon(MOON, 'rm-journey-stop__badge rm-journey-stop__badge--night'));
  }
  face.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  root.append(face);
  return root;
}

const faceOf = (marker: Marker) => marker.getElement().firstElementChild as HTMLElement;

/** How much a place's marker matters when there's only room for some: lower first. */
function markerRank(stops: readonly JourneyStop[], face: HTMLElement): number {
  if (face.classList.contains('rm-journey-stop--selected')) return 0;
  if (stops.some((s) => s.isHome || s.kind === 'start' || s.kind === 'end')) return 1;
  if (stops.some((s) => s.nights > 0)) return 2;
  if (stops.some((s) => s.charges.length > 0)) return 3;
  return 4;
}

const stayedMs = (stops: readonly JourneyStop[]) =>
  stops.reduce(
    (sum, s) => sum + (s.endedAt ? Date.parse(s.endedAt) - Date.parse(s.startedAt) : 0),
    0,
  );

/**
 * Hides markers that would sit on another, so a busy trip zoomed out shows
 * its main stops rather than a pile; zooming in brings the rest back.
 */
function declutter(map: MapLibreMap, entries: readonly { marker: Marker; stops: JourneyStop[] }[]) {
  const GAP = 3;
  const ranked = entries
    .map(({ marker, stops }) => {
      const face = faceOf(marker);
      return {
        face,
        point: map.project(marker.getLngLat()),
        quiet: face.classList.contains('rm-journey-stop--quiet') ? 1 : 0,
        rank: markerRank(stops, face),
        stayed: stayedMs(stops),
      };
    })
    .sort((a, b) => a.quiet - b.quiet || a.rank - b.rank || b.stayed - a.stayed);
  const kept: { left: number; right: number; top: number; bottom: number }[] = [];
  for (const { face, point } of ranked) {
    const w = face.offsetWidth / 2 + GAP;
    const h = face.offsetHeight / 2 + GAP;
    const box = { left: point.x - w, right: point.x + w, top: point.y - h, bottom: point.y + h };
    const hit = kept.some(
      (k) => box.left < k.right && box.right > k.left && box.top < k.bottom && box.bottom > k.top,
    );
    face.classList.toggle('rm-journey-stop--hidden', hit);
    if (!hit) kept.push(box);
  }
}

/** What a visit was, beside its details: "Start", "Stop 4", "Charge", "Finish". */
function visitLabel(stop: JourneyStop): string {
  if (stop.number != null) return `Stop ${stop.number}`;
  return { start: 'Start', end: 'Finish', charge: 'Charge', stop: 'Stop' }[stop.kind];
}

/**
 * The place once, then each visit to it on a line of its own. Plain text
 * nodes only: place names come from outside services.
 */
function popupContent(
  stops: readonly JourneyStop[],
  describe: (stop: JourneyStop) => string,
): HTMLElement {
  const root = document.createElement('div');
  root.className = 'rm-journey-popup';
  const title = document.createElement('div');
  title.className = 'rm-journey-popup__title';
  title.textContent = stops.find((s) => s.place)?.place ?? 'Unnamed place';
  const visits = document.createElement('div');
  visits.className = 'rm-journey-popup__visits';
  for (const stop of stops) {
    const label = document.createElement('div');
    label.className = 'rm-journey-popup__visit';
    label.textContent = visitLabel(stop);
    const detail = document.createElement('div');
    detail.className = 'rm-journey-popup__detail';
    detail.textContent = describe(stop) || '—';
    visits.append(label, detail);
  }
  root.append(title, visits);
  return root;
}

/**
 * The whole journey. Each day has its color, and each stretch of road is
 * drawn once, however often it was driven; picking a drive or a
 * day greys the rest and draws it whole on top; and the replay draws the
 * journey in order.
 */
export function JourneyMap(props: {
  legs: JourneyLeg[];
  stops: JourneyStop[];
  /** A day to show on its own. */
  focusDay: string | null;
  selected: Selection;
  onSelect: (selection: Selection) => void;
  /** 0–1 along the journey while replaying; null otherwise. */
  replay: number | null;
  describeStop: (stop: JourneyStop) => string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const maplibreRef = useRef<Awaited<ReturnType<typeof loadMaplibre>> | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const markerStops = useRef<{ marker: Marker; stops: JourneyStop[] }[]>([]);
  const popupRef = useRef<Popup | null>(null);
  const headRef = useRef<Marker | null>(null);
  const [ready, setReady] = useState(false);

  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });

  const places = useMemo(() => stopPlaces(props.stops), [props.stops]);
  const everything = useMemo(
    () => [...props.legs.flatMap((l) => l.points), ...places.map((p) => p.at)],
    [props.legs, places],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let map: MapLibreMap | undefined;
    let observer: ResizeObserver | undefined;
    void loadMaplibre().then((maplibre) => {
      if (cancelled) return;
      maplibreRef.current = maplibre;
      const start = bounds([
        ...latest.current.legs.flatMap((l) => l.points),
        ...latest.current.stops.flatMap((s) => (s.at ? [s.at] : [])),
      ]);
      map = new maplibre.Map({
        container,
        style: themedStyle(),
        ...(start ? { bounds: start, fitBoundsOptions: FIT } : { center: [0, 20], zoom: 1 }),
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
        map.addImage(ARROW, arrowImage());
        map.addSource(LEGS, { type: 'geojson', data: EMPTY });
        map.addSource(ROADS, { type: 'geojson', data: EMPTY });
        map.addSource(REPLAY, { type: 'geojson', data: EMPTY });
        const solid: ExpressionSpecification = [
          'all',
          ['!', ['get', 'gap']],
          ['!', ['get', 'missing']],
        ];
        const lineLayout = { 'line-cap': 'round', 'line-join': 'round' } as const;
        map.addLayer({
          id: 'journey-line',
          type: 'line',
          source: ROADS,
          filter: solid,
          layout: { ...lineLayout, 'line-sort-key': ['get', 'order'] },
          paint: {
            'line-color': ['get', 'color'],
            'line-width': width(2.5, 4.5),
            'line-offset': OFFSET,
          },
        });
        map.addLayer({
          id: 'journey-gap',
          type: 'line',
          source: ROADS,
          filter: ['get', 'gap'],
          paint: {
            'line-color': ['get', 'color'],
            'line-width': 2,
            'line-dasharray': [1, 2.5],
            'line-opacity': 0.7,
          },
        });
        // Driving that isn't in the trip: grey and sparse, so it reads as a
        // hole bridged, not a road taken.
        map.addLayer({
          id: 'journey-missing',
          type: 'line',
          source: ROADS,
          filter: ['get', 'missing'],
          layout: { 'line-cap': 'round' },
          paint: {
            'line-color': QUIET_LINE,
            'line-width': width(2.5, 4),
            'line-dasharray': [0.5, 2],
            'line-opacity': 0.9,
          },
        });
        map.addLayer({
          id: 'journey-focus',
          type: 'line',
          source: LEGS,
          filter: ['==', ['get', 'driveId'], -1],
          layout: lineLayout,
          paint: {
            'line-color': ['get', 'color'],
            'line-width': width(3.5, 5.5),
            'line-offset': OFFSET,
          },
        });
        // Arrows ride the lines they point along: the roads, or what's in focus over them.
        const arrowLayers: [string, string, ExpressionSpecification][] = [
          ['journey-arrows', ROADS, solid],
          ['journey-focus-arrows', LEGS, ['==', ['get', 'driveId'], -1]],
        ];
        for (const [id, source, filter] of arrowLayers) {
          map.addLayer({
            id,
            type: 'symbol',
            source,
            filter,
            minzoom: 11,
            layout: {
              'symbol-placement': 'line',
              'symbol-spacing': 220,
              'icon-image': ARROW,
              'icon-size': 0.6,
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
              'icon-offset': ['literal', [0, 0]],
            },
            paint: { 'icon-opacity': 0.75 },
          });
        }
        map.addLayer({
          id: 'journey-replay',
          type: 'line',
          source: REPLAY,
          layout: lineLayout,
          paint: {
            'line-color': ['get', 'color'],
            'line-width': width(3.5, 5.5),
            'line-offset': OFFSET,
          },
        });
        // Wider than the line, so a drive is easy to click or tap.
        map.addLayer({
          id: 'journey-hit',
          type: 'line',
          source: LEGS,
          paint: {
            'line-color': '#000000',
            'line-opacity': 0,
            'line-width': 18,
            'line-offset': OFFSET,
          },
        });
        map.on('click', 'journey-hit', (e) => {
          const id = e.features?.[0]?.properties?.driveId as number | undefined;
          if (id != null) latest.current.onSelect({ kind: 'drive', id });
        });
        map.on('click', (e) => {
          if (!map?.queryRenderedFeatures(e.point, { layers: ['journey-hit'] }).length) {
            latest.current.onSelect(null);
          }
        });
        map.on('zoomend', () => {
          if (map) declutter(map, markerStops.current);
        });
        map.on('mouseenter', 'journey-hit', () => {
          if (map) map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'journey-hit', () => {
          if (map) map.getCanvas().style.cursor = '';
        });
        setReady(true);
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
      markersRef.current = [];
      markerStops.current = [];
      popupRef.current = null;
      headRef.current = null;
    };
  }, []);

  // The routes.
  const legsKey = props.legs.map((l) => `${l.id}:${l.points.length}:${l.color}`).join(',');
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource(LEGS) as GeoJSONSource | undefined)?.setData(legFeatures(latest.current.legs));
    (map.getSource(ROADS) as GeoJSONSource | undefined)?.setData(
      roadFeatures(journeyRoads(latest.current.legs)),
    );
  }, [legsKey, ready]);

  // The stops, one marker a place.
  const stopsKey = props.stops
    .map((s) => `${s.id}:${s.number}:${s.at}:${s.place}:${s.nights}:${s.charges.length}`)
    .join(',');
  useEffect(() => {
    const map = mapRef.current;
    const maplibre = maplibreRef.current;
    if (!map || !maplibre || !ready) return;
    for (const marker of markersRef.current) marker.remove();
    markerStops.current = places.map((place) => ({
      stops: place.stops,
      marker: new maplibre.Marker({
        element: markerElement(place.stops, () =>
          latest.current.onSelect({ kind: 'stop', id: place.stops[0]!.id }),
        ),
      })
        .setLngLat(toLngLat(place.at))
        .addTo(map),
    }));
    markersRef.current = markerStops.current.map((m) => m.marker);
    declutter(map, markerStops.current);
    // places follows stops, which stopsKey stands for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopsKey, ready]);

  // What's in focus: the rest of the journey dims, and the view frames it.
  const { focusDay, selected, replay } = props;
  const focusDrive = selected?.kind === 'drive' ? selected.id : null;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    // What's in focus is redrawn on top; everything else
    // goes grey, as the days' own colors can be too alike to pick one out.
    const focus: ExpressionSpecification =
      focusDrive != null
        ? ['==', ['get', 'driveId'], focusDrive]
        : focusDay != null
          ? ['==', ['get', 'dayKey'], focusDay]
          : ['==', ['get', 'driveId'], -1];
    map.setFilter('journey-focus', focus);
    const quiet = replay != null || focusDrive != null || focusDay != null;
    map.setPaintProperty('journey-line', 'line-color', quiet ? QUIET_LINE : ['get', 'color']);
    map.setPaintProperty('journey-line', 'line-opacity', quiet ? 0.55 : 1);
    map.setLayoutProperty('journey-arrows', 'visibility', quiet ? 'none' : 'visible');
    map.setFilter('journey-focus-arrows', replay != null ? ['==', ['get', 'driveId'], -1] : focus);
    for (const { marker, stops } of markerStops.current) {
      const el = faceOf(marker);
      const dayOf = (s: JourneyStop) => {
        const d = new Date(s.startedAt);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      };
      el.classList.toggle(
        'rm-journey-stop--quiet',
        focusDrive == null && focusDay != null && !stops.some((s) => dayOf(s) === focusDay),
      );
    }
    declutter(map, markerStops.current);
  }, [focusDrive, focusDay, replay, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const { legs } = latest.current;
    const points =
      focusDrive != null
        ? legs.find((l) => l.id === focusDrive)?.points
        : focusDay != null
          ? legs.filter((l) => l.dayKey === focusDay).flatMap((l) => l.points)
          : everything;
    const frame = points?.length ? bounds(points) : bounds(everything);
    if (frame) map.fitBounds(frame, { ...FIT, duration: 600 });
    // Framed again only when what's in focus changes, not on every refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusDrive, focusDay, ready]);

  // The selected stop or charge says what happened there.
  const selectedStop = selected?.kind === 'stop' ? selected.id : null;
  const selectedCharge = selected?.kind === 'charge' ? selected.id : null;
  useEffect(() => {
    const map = mapRef.current;
    const maplibre = maplibreRef.current;
    popupRef.current?.remove();
    popupRef.current = null;
    if (!map || !maplibre || !ready) return;
    const entry = markerStops.current.find(({ stops }) =>
      stops.some(
        (s) =>
          s.id === selectedStop ||
          (selectedCharge != null && s.charges.some((c) => c.id === selectedCharge)),
      ),
    );
    for (const { marker } of markerStops.current) {
      faceOf(marker).classList.toggle('rm-journey-stop--selected', marker === entry?.marker);
    }
    declutter(map, markerStops.current);
    if (!entry) return;
    popupRef.current = new maplibre.Popup({
      offset: 18,
      closeButton: false,
      closeOnClick: false,
      maxWidth: '260px',
    })
      .setLngLat(entry.marker.getLngLat())
      .setDOMContent(popupContent(entry.stops, latest.current.describeStop))
      .addTo(map);
  }, [selectedStop, selectedCharge, stopsKey, ready]);

  // The replay: draws what's been driven so far, the head at its tip.
  useEffect(() => {
    const map = mapRef.current;
    const maplibre = maplibreRef.current;
    if (!map || !maplibre || !ready) return;
    const source = map.getSource(REPLAY) as GeoJSONSource | undefined;
    if (replay == null) {
      source?.setData(EMPTY);
      headRef.current?.remove();
      headRef.current = null;
      return;
    }
    const frame = replayFrame(latest.current.legs, replay);
    source?.setData({
      type: 'FeatureCollection',
      features: frame.lines
        .filter((l) => l.points.length > 1)
        .map((l) => ({
          type: 'Feature',
          properties: { color: l.color },
          geometry: { type: 'LineString', coordinates: l.points.map(toLngLat) },
        })),
    });
    if (frame.head) {
      if (!headRef.current) {
        const el = document.createElement('div');
        el.className = 'rm-journey-head';
        headRef.current = new maplibre.Marker({ element: el })
          .setLngLat(toLngLat(frame.head))
          .addTo(map);
      } else {
        headRef.current.setLngLat(toLngLat(frame.head));
      }
    }
  }, [replay, legsKey, ready]);

  return <div ref={containerRef} className="rm-map" style={{ height: '100%', width: '100%' }} />;
}
