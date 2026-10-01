import L from "leaflet";
import { useEffect } from "react";
import {
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  useMap,
} from "react-leaflet";

export const MAP_HEIGHT = "20rem";

const vehicleIcon = (bearing: number | null) =>
  L.divIcon({
    className: "",
    html: `<div style="transform: rotate(${bearing ?? 0}deg); font-size: 22px; line-height: 1; filter: drop-shadow(0 1px 2px rgba(0,0,0,.6));">⬆️</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });

const dotIcon = L.divIcon({
  className: "",
  html: `<div style="width:10px;height:10px;border-radius:50%;background:#3987e5;border:2px solid #fff;"></div>`,
  iconSize: [10, 10],
  iconAnchor: [5, 5],
});

/** Frames the whole trail (with a little padding), once per trail. */
function FitTrail(props: { trail: [number, number][] }) {
  const map = useMap();
  const first = props.trail[0];
  const last = props.trail.at(-1);
  const key = `${props.trail.length}|${first}|${last}`;
  useEffect(() => {
    if (props.trail.length > 1) map.fitBounds(L.latLngBounds(props.trail), { padding: [24, 24] });
    // Re-fit only when the trail itself changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return null;
}

/** Leaflet sizes itself once; this keeps it right when its container resizes. */
function AutoResize() {
  const map = useMap();
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}

function Recenter(props: { lat: number; lon: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([props.lat, props.lon]);
  }, [map, props.lat, props.lon]);
  return null;
}

export function VehicleMap(props: {
  lat: number;
  lon: number;
  bearing?: number | null;
  trail?: [number, number][];
  height?: string;
  follow?: boolean;
}) {
  return (
    <MapContainer
      center={[props.lat, props.lon]}
      zoom={14}
      style={{ height: props.height ?? MAP_HEIGHT, width: "100%" }}
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {props.trail && props.trail.length > 1 && (
        <Polyline positions={props.trail} pathOptions={{ color: "#3987e5", weight: 3 }} />
      )}
      <Marker
        position={[props.lat, props.lon]}
        icon={props.bearing != null ? vehicleIcon(props.bearing) : dotIcon}
      />
      {props.follow !== false && <Recenter lat={props.lat} lon={props.lon} />}
      {props.follow === false && props.trail && <FitTrail trail={props.trail} />}
      <AutoResize />
    </MapContainer>
  );
}
