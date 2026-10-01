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
    </MapContainer>
  );
}
