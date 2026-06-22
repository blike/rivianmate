import { formatCoordinates, formatDateTime } from "../../utils/formatters.js";

interface LocationMapProps {
  latitude: number | null;
  longitude: number | null;
  lastUpdatedAt: string | null;
}

export function LocationMap({ latitude, longitude, lastUpdatedAt }: LocationMapProps) {
  if (latitude == null || longitude == null) {
    return (
      <div className="mapSurface emptyMap">
        <div>
          <strong>No location yet</strong>
          <span>Waiting for a vehicle-state event with coordinates.</span>
        </div>
      </div>
    );
  }

  const delta = 0.012;
  const bbox = [longitude - delta, latitude - delta, longitude + delta, latitude + delta].join(",");
  const marker = `${latitude},${longitude}`;
  const embedUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(marker)}`;
  const openStreetMapUrl = `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=15/${latitude}/${longitude}`;

  return (
    <div className="mapSurface liveMap">
      <iframe src={embedUrl} title="Current vehicle location map" />
      <div className="mapOverlay">
        <strong>{formatCoordinates(latitude, longitude)}</strong>
        <span>{formatDateTime(lastUpdatedAt)}</span>
        <a href={openStreetMapUrl} rel="noreferrer" target="_blank">
          Open map
        </a>
      </div>
    </div>
  );
}
