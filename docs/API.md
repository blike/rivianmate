# RivianMate API

RivianMate exposes a small, read-only public HTTP API for dashboard widgets (such as
[Homepage](https://gethomepage.dev/)), home automation tools, and scripts.

All public endpoints are served from RivianMate's in-memory state cache and local PostgreSQL
database—calling them never polls Rivian's cloud and never wakes your vehicle.

> **Internal endpoints:** RivianMate's web interface uses additional `/api/*` endpoints internally.
> Those endpoints require a browser session cookie (API keys receive `403 Forbidden`) and may change
> shape between releases.

Response TypeScript types are defined in [`server/src/api-types.ts`](../server/src/api-types.ts).

## Authentication & Creating an API Key

Public API requests authenticate with a read-only Bearer API key in the `Authorization` header:

```text
Authorization: Bearer rmk_<secret>
```

### Creating a key

1. Open RivianMate in your browser and go to **Settings → Security → API keys**.
2. Click **Create key**, give it a name (e.g. `Homepage`), and optionally choose an expiration.
3. Copy the `rmk_...` secret immediately—it is shown only once. RivianMate stores a SHA-256 hash in
   PostgreSQL and tracks when each key was last used (updated at most once per minute).

You can create up to **50** keys and revoke any key immediately from **Settings → Security**.

### Behavior and errors

- Keys are accepted **only** in the `Authorization: Bearer <key>` header (not in query parameters).
- Keys are strictly read-only and only work on the public endpoints listed below.
- **Status codes:**
  - `401 Unauthorized` (`{"error":"Not authenticated"}`): missing, invalid, expired, or revoked key.
  - `403 Forbidden` (`{"error":"This endpoint requires a browser session"}`): valid API key sent to
    an internal session-only endpoint.
  - `404 Not Found`: unknown vehicle or no telemetry received yet.

## Public Endpoints

| Method | Path                        | Description                                                      |
| ------ | --------------------------- | ---------------------------------------------------------------- |
| `GET`  | `/api/vehicles`             | List vehicles (use this to find your vehicle `id`)               |
| `GET`  | `/api/vehicles/:id/summary` | Flat, unit-converted vehicle snapshot for widgets & integrations |

### `GET /api/vehicles`

Lists all Rivian vehicles (and TeslaMate vehicles, if configured, with `tm-*` IDs and
`source: "teslamate"`).

```sh
curl -fsS -H "Authorization: Bearer rmk_your_key" \
  "https://rivianmate.example.com/api/vehicles"
```

Example response (`200 OK`, `VehicleDto[]`):

```json
[
  {
    "id": "01-123456789",
    "vin": "7PDSGABA...",
    "name": "Blue",
    "make": "Rivian",
    "model": "R1S",
    "modelYear": 2025,
    "renders": ["three-quarter", "overhead"],
    "source": "rivian"
  }
]
```

### `GET /api/vehicles/:id/summary`

Returns a flat, unit-converted vehicle snapshot tailored for dashboard widgets and scripts. Works
for both Rivian and TeslaMate vehicles.

- **Query parameters:**
  - `units` (optional):
    - `user` (default) — follows **Settings → General → Units**
    - `imperial` — `mi`, `mph`, `°F`, `psi`, `ft`
    - `metric` — `km`, `km/h`, `°C`, `bar`, `m`
- **Errors:** returns `404 Not Found` (`{"error":"No state yet"}`) if no telemetry has been received
  for the vehicle yet.

```sh
curl -fsS -H "Authorization: Bearer rmk_your_key" \
  "https://rivianmate.example.com/api/vehicles/01-123456789/summary?units=user"
```

Example response (`200 OK`, `VehicleSummaryDto`):

```json
{
  "id": "01-123456789",
  "vin": "7PDSGABA...",
  "name": "Blue",
  "make": "Rivian",
  "model": "R1S",
  "modelYear": 2025,
  "source": "rivian",
  "status": "parked",
  "statusLabel": "Parked",
  "online": true,
  "lastSync": "2026-11-24T20:24:53.464Z",
  "batteryLevel": 78.5,
  "batteryLimit": 80,
  "batteryCapacityKwh": 135.2,
  "batteryTemp": 60.8,
  "range": 241.7,
  "odometer": 321.9,
  "speed": 0,
  "altitude": 820,
  "gear": "park",
  "driveMode": "everyday",
  "powerState": "ready",
  "pluggedIn": false,
  "charging": false,
  "chargerState": "charging_ready",
  "timeToEndOfChargeMin": null,
  "chargingPowerKw": null,
  "cabinTemp": 68,
  "targetTemp": 70.7,
  "tirePressures": {
    "frontLeft": 48,
    "frontRight": 48,
    "rearLeft": 48,
    "rearRight": 47.1
  },
  "locked": true,
  "openClosures": [],
  "softwareVersion": "2026.10.01",
  "updateAvailable": null,
  "location": { "lat": 40.5142, "lon": -88.9906, "ts": "2026-11-24T20:24:53.464Z" },
  "units": {
    "distance": "mi",
    "speed": "mph",
    "temperature": "F",
    "pressure": "psi",
    "elevation": "ft"
  }
}
```

## Homepage (`customapi` Widget)

Use `GET /api/vehicles/:id/summary` with an API key to display vehicle status in
[Homepage](https://gethomepage.dev/) (`services.yaml`):

```yaml
widget:
  type: customapi
  url: https://rivianmate.example.com/api/vehicles/<vehicleId>/summary?units=user
  refreshInterval: 30000
  headers:
    Authorization: Bearer rmk_your_key
  mappings:
    - field: batteryLevel
      label: Battery
      format: percent
    - field: range
      label: Range
      format: number
      suffix: ' mi'
    - field: odometer
      label: Odometer
      format: number
      suffix: ' mi'
    - field: statusLabel
      label: Status
      format: text
    - field: cabinTemp
      label: Cabin
      format: number
      suffix: ' °F'
```

Replace `<vehicleId>` with the `id` returned by `GET /api/vehicles`, and adjust the suffixes if you
use metric units (`km`, `°C`).
