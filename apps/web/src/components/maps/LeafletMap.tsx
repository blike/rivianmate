import { useEffect, useRef } from "react";
import type { DriveDetail } from "../../types/index.js";

// Leaflet is loaded from CDN — declare the globals it injects
declare const L: {
  map: (el: HTMLElement, opts: object) => LMap;
  tileLayer: (url: string, opts: object) => { addTo: (map: LMap) => void };
  polyline: (
    coords: [number, number][],
    opts: object
  ) => { addTo: (map: LMap) => { getBounds: () => LBounds } };
  circleMarker: (coords: [number, number], opts: object) => { addTo: (map: LMap) => unknown };
};
interface LMap {
  fitBounds: (b: LBounds, opts?: object) => void;
  remove: () => void;
}
interface LBounds {
  pad: (n: number) => LBounds;
}

interface LeafletMapProps {
  positions: DriveDetail["positions"];
}

export function LeafletMap({ positions }: LeafletMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LMap | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || positions.length === 0) return;
    if (typeof L === "undefined") return;

    mapRef.current?.remove();

    const map = L.map(el, { zoomControl: true });
    mapRef.current = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
    }).addTo(map);

    const coords: [number, number][] = positions.map((p) => [p.latitude, p.longitude]);
    const line = L.polyline(coords, { color: "#00a651", opacity: 0.85, weight: 3 }).addTo(map);
    map.fitBounds(line.getBounds().pad(0.1));

    L.circleMarker(coords[0]!, { color: "#00a651", fill: true, fillOpacity: 1, radius: 7 }).addTo(map);
    L.circleMarker(coords[coords.length - 1]!, { color: "#ef4444", fill: true, fillOpacity: 1, radius: 7 }).addTo(map);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [positions]);

  return (
    <div className="mapSurface liveMap">
      <div ref={containerRef} style={{ height: "100%", width: "100%" }} />
    </div>
  );
}
