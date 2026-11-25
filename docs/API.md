# RivianMate API

RivianMate exposes a JSON HTTP API and Server-Sent Events (SSE) streams under `/api/*`. The web
interface uses this API exclusively, and you can call the same endpoints from scripts, home
automation tools, or custom integrations.

RivianMate is strictly **read-only toward Rivian vehicles**: there are no endpoints to lock, unlock,
climate-control, or send commands to a vehicle. Write endpoints (`POST`, `PUT`, `PATCH`, `DELETE`)
only manage RivianMate's own configuration, Rivian account session, saved locations, trips, drive
annotations, charging costs, and data imports.

All request and response types are defined in
[`server/src/api-types.ts`](../server/src/api-types.ts).

## Contents

- [Authentication & Setup](#authentication--setup)
- [Using the API in Production](#using-the-api-in-production)
- [Conventions](#conventions)
- [Endpoint Reference](#endpoint-reference)
  - [Authentication & Setup](#1-authentication--setup)
  - [API Keys](#2-api-keys)
  - [Rivian Account & Diagnostics](#3-rivian-account--diagnostics)
  - [Vehicles, Live State & Renders](#4-vehicles-live-state--renders)
  - [Orders](#5-orders)
  - [History, Drives & Locations](#6-history-drives--locations)
  - [Charging & Wallboxes](#7-charging--wallboxes)
  - [Vehicle Health & OTA Updates](#8-vehicle-health--ota-updates)
  - [Trips](#9-trips)
  - [Saved Locations & Geocoding](#10-saved-locations--geocoding)
  - [Settings, Notifications & TeslaMate](#11-settings-notifications--teslamate)
  - [Data Imports](#12-data-imports)
  - [Server Logs](#13-server-logs)
- [Server-Sent Events (SSE)](#server-sent-events-sse)
- [Current Limitations](#current-limitations)

---

## Authentication & Setup

### How Authentication Works

RivianMate is a single-user application protected by a password hashed with `scrypt` and stored in
PostgreSQL (`app_settings.app_password_hash`).

The API supports **two authentication methods**:

1. **Bearer API keys (recommended for scripts, Home Assistant, and production integrations):**
   - Header: `Authorization: Bearer rmk_<secret>`
   - Created in **Settings → Security → API keys** (or via `POST /api/api-keys` using a browser
     session).
   - Stored in PostgreSQL (`api_keys`) as a **SHA-256 hash** only—the raw key is displayed once at
     creation time.
   - Scoped to either **`read`** (`GET`/`HEAD` endpoints and live SSE streams only) or **`write`**
     (read endpoints plus trips, saved locations, drive drivers, charging costs, settings, and data
     imports).
   - Optional expiration timestamp, `lastUsedAt` tracking (throttled to once per minute), and
     instant per-key revocation.
   - **Session-only boundary:** Neither `read` nor `write` API keys can manage other API keys
     (`/api/api-keys*`), change the app password (`/api/auth/change-password`), log out
     (`/api/auth/logout`), connect/disconnect Rivian (`/api/rivian/connect`, `/api/rivian/otp`,
     `/api/rivian/disconnect`), or modify/remove the TeslaMate database URL
     (`PUT`/`DELETE /api/settings/teslamate`). Those endpoints return `403 Forbidden`.
   - API keys are accepted **only** in the `Authorization` header (never in query parameters, which
     leak into proxy access logs). If an `Authorization` header is present and invalid, RivianMate
     returns `401` without falling back to a session cookie.

2. **Session cookie (used by the web interface and initial setup/account management):**
   - **Cookie name:** `rivianmate_session`
   - **Format:** `<expiryEpochMs>.<base64url-hmac-sha256>`
   - **Signing key:** derived from `APP_SECRET` using `scrypt` (`rivianmate-session-key`)
   - **Attributes:** `Path=/`, `HttpOnly`, `SameSite=Lax`, `Max-Age=2592000` (30 days), and `Secure`
     automatically whenever the request arrives over HTTPS (directly or behind a reverse proxy with
     `TRUST_PROXY` enabled).

Every `/api/*` endpoint requires either a valid Bearer API key or a valid `rivianmate_session`
cookie **except** three public endpoints:

| Endpoint               | Purpose                                                                           |
| ---------------------- | --------------------------------------------------------------------------------- |
| `GET /api/status`      | Setup, auth, and connection status (redacts account details when unauthenticated) |
| `POST /api/setup`      | First-run password creation (disabled once a password is set)                     |
| `POST /api/auth/login` | Exchanges the application password for a session cookie                           |

Any other `/api/*` request without valid credentials receives `401 Unauthorized`:

```json
{ "error": "Not authenticated" }
```

Requests authenticated with an API key that lacks permission for the route or HTTP method receive
`403 Forbidden`:

```json
{ "error": "API key has read-only access" }
```

### Initial Setup Flows

There are two ways to initialize authentication on a new instance:

#### Option 1: Interactive First-Run Setup (`POST /api/setup`)

When no password is set (`GET /api/status` returns `needsSetup: true`), create the password and
receive a session cookie in one step:

```sh
curl -i -c cookies.txt -X POST https://rivianmate.example.com/api/setup \
  -H 'Content-Type: application/json' \
  -d '{"password":"a-strong-passphrase-here"}'
```

Once a password exists, `POST /api/setup` returns `409 Conflict`.

#### Option 2: Pre-Configured Password (`APP_PASSWORD`)

For automated or headless deployments, set `APP_PASSWORD` in `.env` before first boot. On startup,
RivianMate validates the password against its password policy, hashes it into the database, and
skips the password-creation screen (`needsSetup: false`, `signInStartsSetup: true`). `APP_PASSWORD`
is ignored on subsequent boots once a password hash exists in the database.

Then sign in with `POST /api/auth/login`:

```sh
curl -i -c cookies.txt -X POST https://rivianmate.example.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"password":"a-strong-passphrase-here"}'
```

#### Connecting Your Rivian Account via API

After authenticating with RivianMate, connect your Rivian account:

```sh
# 1. Start Rivian login
curl -b cookies.txt -X POST https://rivianmate.example.com/api/rivian/connect \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"your-rivian-password"}'
# Returns {"ok":false,"otpRequired":true} if MFA is enabled, or {"ok":true}

# 2. Submit the 2FA verification code (if otpRequired was true)
curl -b cookies.txt -X POST https://rivianmate.example.com/api/rivian/otp \
  -H 'Content-Type: application/json' \
  -d '{"code":"123456"}'

# 3. Complete first-run external lookup choice (enables or disables Nominatim & Open-Meteo)
curl -b cookies.txt -X PUT https://rivianmate.example.com/api/settings/lookups \
  -H 'Content-Type: application/json' \
  -d '{"addresses":true,"weather":true}'
```

### Password Policy

New passwords (`POST /api/setup`, `POST /api/auth/change-password`, and `APP_PASSWORD`) follow NIST
SP 800-63B guidelines:

- **Length:** 12 to 128 characters.
- **Variety:** at least 5 distinct characters (case-insensitive).
- **Guessability:** at least 8 characters remaining after removing common/app words (`rivian`,
  `rivianmate`, `r1t`, `r1s`, `password`, `admin`, `qwerty`, etc.) and runs of 4+ repeated or
  sequential characters (`1234`, `abcd`, `aaaa`, keyboard rows).

### Login Rate Limiting

`POST /api/auth/login` and `POST /api/auth/change-password` enforce an in-memory per-IP throttle:

- **Limit:** 10 failed password attempts per 15-minute sliding window per client IP.
- **Response when exceeded:** `429 Too Many Requests` with a `Retry-After` header (seconds) and
  `{"error":"Too many attempts; try again later"}`.
- A successful password check clears the failure counter for that IP.

### Session Lifecycle & Revocation

- Sessions expire **30 days** after login and do not slide/extend automatically. Programmatic
  clients should detect `401` responses and re-authenticate via `POST /api/auth/login`.
- `POST /api/auth/logout` clears the cookie on the client, but because cookies are stateless, any
  previously copied cookie remains valid until its 30-day expiry.
- Changing `APP_SECRET` immediately invalidates all active session cookies, **but it also
  invalidates encrypted Rivian tokens, TeslaMate database URLs, and notification webhook URLs**
  stored in PostgreSQL, requiring those credentials to be re-entered.

### Client Examples

#### curl (API Key — Recommended)

Create a **Read-only** API key under **Settings → Security → API keys** (or via `POST /api/api-keys`
from a logged-in session), then send it as a Bearer token:

```sh
BASE_URL="https://rivianmate.example.com"
API_KEY="rmk_your_api_key_here"

# Verify the key and inspect its scope
curl -fsS -H "Authorization: Bearer $API_KEY" "$BASE_URL/api/auth/session"

# List vehicles
curl -fsS -H "Authorization: Bearer $API_KEY" "$BASE_URL/api/vehicles"

# Read latest state for a vehicle
curl -fsS -H "Authorization: Bearer $API_KEY" "$BASE_URL/api/vehicles/<vehicleId>/state"
```

#### Python (`requests` with API Key)

```python
import os
import requests

BASE_URL = "https://rivianmate.example.com"
headers = {"Authorization": f"Bearer {os.environ['RIVIANMATE_API_KEY']}"}

vehicles = requests.get(f"{BASE_URL}/api/vehicles", headers=headers, timeout=10).json()
for v in vehicles:
    state = requests.get(
        f"{BASE_URL}/api/vehicles/{v['id']}/state", headers=headers, timeout=10
    ).json()
    print(v["name"], state.get("batteryLevel", {}).get("value"))
```

#### Node.js (`fetch` with API Key)

```js
const BASE_URL = 'https://rivianmate.example.com';
const headers = { Authorization: `Bearer ${process.env.RIVIANMATE_API_KEY}` };

const vehicles = await fetch(`${BASE_URL}/api/vehicles`, { headers }).then((r) => r.json());
```

#### curl (Cookie Jar — Needed for Session-Only Endpoints)

```sh
BASE_URL="https://rivianmate.example.com"

# Authenticate and save session cookie
curl -fsS -c cookies.txt -X POST "$BASE_URL/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"password":"your-app-password"}'

# Mint a read-only API key from the session
curl -fsS -b cookies.txt -X POST "$BASE_URL/api/api-keys" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Home Assistant","scope":"read"}'
```

---

## Using the API in Production

### Network, TLS & `TRUST_PROXY`

RivianMate listens on plain HTTP (`0.0.0.0:4000` by default) and does **not** terminate TLS itself.

For production API access:

1. **Never expose port 4000 directly to the public internet.** Bind it to loopback
   (`127.0.0.1:4000:4000`) or a private Docker network, and put a TLS-terminating reverse proxy
   (Caddy, nginx, Traefik) or a private mesh VPN (Tailscale, WireGuard) in front of it.
2. **Set `TRUST_PROXY` in `.env` when running behind a reverse proxy.**
   - By default (`TRUST_PROXY=false`), Fastify ignores `X-Forwarded-For` and `X-Forwarded-Proto` so
     direct clients cannot spoof them.
   - Behind a single reverse proxy (nginx, Caddy, Traefik), set `TRUST_PROXY=1` (or the proxy's
     subnet, e.g. `TRUST_PROXY=loopback` or `TRUST_PROXY=127.0.0.1,172.16.0.0/12`).
   - Behind two proxies (for example, Cloudflare → nginx → RivianMate), set `TRUST_PROXY=2`.
   - With `TRUST_PROXY` enabled and your proxy forwarding `X-Forwarded-For` and
     `X-Forwarded-Proto: https`:
     - Login rate limiting (`10 failures / 15 min`) tracks each end client's IP rather than the
       proxy's IP.
     - `rivianmate_session` automatically includes the **`Secure`** cookie flag over HTTPS while
       remaining usable over plain HTTP on localhost/LAN.
3. **Prefer scoped API keys over password logins.** Use `scope: "read"` keys for dashboards, Home
   Assistant, and monitoring scripts, and set an optional expiry or rotate keys individually without
   touching `APP_SECRET` or your app password.
4. **Keep `APP_SECRET` stable and secret.** Generate it with `openssl rand -hex 32` (minimum 32
   characters). Store it in a secret manager or a root-readable `.env` file (`chmod 600 .env`).
5. **No CORS headers:** RivianMate does not send `Access-Control-*` headers, so third-party browser
   origins cannot make authenticated requests directly. Call the API from backend services, scripts,
   or same-origin tools.

### Reverse Proxy Configuration

Two features need special attention in reverse proxies:

- **Server-Sent Events (SSE):** `/api/vehicles/:id/live` and `/api/logs/stream` are long-lived
  streams. RivianMate sends `X-Accel-Buffering: no` and a `:ka` comment every 25 seconds, but your
  proxy must disable response buffering and allow long read timeouts.
- **Large file uploads:** `POST /api/imports/files` streams raw binary exports up to **1 GiB** per
  file. Raise your proxy's request body size limit if you import exports through it.

#### nginx Example

Pair this configuration with `TRUST_PROXY=1` (or `TRUST_PROXY=loopback`) in `.env`:

```nginx
server {
    listen 443 ssl http2;
    server_name rivianmate.example.com;

    ssl_certificate     /etc/letsencrypt/live/rivianmate.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/rivianmate.example.com/privkey.pem;

    # Allow large ElectraFi / Rivian Roamer import uploads (up to 1 GiB)
    client_max_body_size 1024m;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Long-lived SSE endpoints: disable buffering and extend read timeout
    location ~ ^/api/(vehicles/[^/]+/live|logs/stream)$ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 24h;
    }
}
```

#### Caddy Example

Pair this configuration with `TRUST_PROXY=1` (or `TRUST_PROXY=loopback`) in `.env`. Caddy forwards
`X-Forwarded-For` and `X-Forwarded-Proto`, manages TLS, and handles large bodies automatically:

```caddyfile
rivianmate.example.com {
    reverse_proxy 127.0.0.1:4000 {
        flush_interval -1
    }
}
```

### Polling, SSE & Impact on Rivian

- **Calling RivianMate's read endpoints never polls Rivian's cloud.** Vehicle state, drives,
  charging sessions, history, health, and orders are served from RivianMate's in-memory state and
  PostgreSQL database.
- **Prefer SSE (`/api/vehicles/:id/live`)** over polling `/api/vehicles/:id/state` when building
  live dashboards or automations—it pushes updates immediately with minimal overhead.
- **Response compression:** JSON responses are automatically compressed (`gzip`/`br`/`deflate`) when
  the client sends `Accept-Encoding`. SSE streams bypass compression.
- **Health checks:** Poll `GET /api/status` (unauthenticated, lightweight) for container/load
  balancer liveness checks. The official Docker image checks `http://127.0.0.1:4000/api/status`
  every 30 seconds.

### Long-Running Integrations

- **Use an API key** instead of logging in with your app password on a schedule—API key verification
  is a fast SHA-256 index lookup, whereas password login intentionally uses CPU-intensive `scrypt`.
- **Keep scopes minimal:** use `scope: "read"` unless your integration creates trips, edits charging
  costs, or manages locations/settings.
- **For read-only BI/analytics workloads** (e.g., Grafana), you can also read PostgreSQL directly
  with a read-only role; see [docs/GRAFANA.md](GRAFANA.md).

---

## Conventions

### Units

The API always stores and returns **canonical SI/metric values** regardless of the user's display
preferences in `/api/settings/units`:

| Measurement          | API Unit                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Distance & range     | Kilometers (`km`) — except `vehicleMileage` in raw `VehicleState`, which Rivian reports in **meters** (`m`)            |
| Speed                | Kilometers per hour (`km/h`) — except `gnssSpeed` / `navLocation.speedMps` in raw `VehicleState`, which are in **m/s** |
| Elevation / altitude | Meters (`m`)                                                                                                           |
| Temperature          | Degrees Celsius (`°C`)                                                                                                 |
| Tire pressure        | Bar (`bar`)                                                                                                            |
| Energy & capacity    | Kilowatt-hours (`kWh`)                                                                                                 |
| Power                | Kilowatts (`kW`)                                                                                                       |
| Duration             | Seconds (`s`) or minutes (`min`), indicated by field name                                                              |
| Timestamps           | ISO 8601 UTC strings (`2026-11-24T19:15:00.000Z`)                                                                      |
| Calendar dates       | `YYYY-MM-DD` interpreted in the request's IANA `timeZone` / `tz`                                                       |

### Pagination & List Windows

Listing endpoints (`/api/vehicles/:id/drives` and `/api/vehicles/:id/charging-sessions`) accept a
common query window and always return items **newest first**:

| Query Param | Type          | Behavior                                                                                                                                        |
| ----------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| _(none)_    | —             | Returns the newest **200** records (`LIST_LIMIT = 200`).                                                                                        |
| `before`    | ISO 8601 date | Returns up to **200** records with `startedAt < before` (next older page).                                                                      |
| `after`     | ISO 8601 date | Returns up to **200** records with `startedAt > after` (next newer page, using `after + 1ms` to avoid microsecond duplicates).                  |
| `from`      | ISO 8601 date | Includes records with `startedAt >= from`. When `from` or `to` is set, the 200-item limit is **removed** and all matching records are returned. |
| `to`        | ISO 8601 date | Includes records with `startedAt <= to`. Removes the 200-item limit.                                                                            |

To paginate through all history, start with no parameters and pass the oldest returned item's
`startedAt` as `before` until fewer than 200 records are returned.

### Error Responses

Errors return JSON with an `error` message string:

```json
{ "error": "Not found" }
```

Zod schema validation failures on standard routes return `400 Bad Request` with field-level details:

```json
{
  "error": "Invalid request",
  "details": ["name: Too small: expected string to have >=1 characters"]
}
```

| Status | Meaning                                                                                                   |
| ------ | --------------------------------------------------------------------------------------------------------- |
| `400`  | Validation error, weak password, invalid parameters, or business rule violation                           |
| `401`  | Missing/expired session cookie or API key, invalid password, or Rivian rejected credentials               |
| `403`  | Valid API key lacks permission (read-only key on write route, or session-only endpoint)                   |
| `404`  | Resource, vehicle state, feed, render, or release notes not found                                         |
| `409`  | Conflict (already set up, no pending OTP login, overlapping trip dates, activity already in another trip) |
| `415`  | Unsupported `Content-Type` (e.g., `/api/imports/files` requires `application/octet-stream`)               |
| `429`  | Local login throttle exceeded (includes `Retry-After` header) or Rivian rate-limiting                     |
| `500`  | Unexpected server error                                                                                   |
| `502`  | Upstream dependency unavailable (Nominatim place search or Rivian render fetch)                           |

### Rivian vs. TeslaMate Vehicles

If a TeslaMate database is configured (`/api/settings/teslamate`), its vehicles appear alongside
Rivian vehicles in `GET /api/vehicles` with `source: "teslamate"` and IDs prefixed with `tm-` (for
example, `tm-1`).

Most vehicle read endpoints work transparently with `tm-*` IDs, with a few read-only/source
differences:

- `GET /api/vehicles/:id/plugged-in` returns `{ "pluggedInAt": null }`.
- `GET /api/vehicles/:id/schedules` returns empty schedules (`departuresUnavailable: true`).
- `GET /api/vehicles/:id/parked-days` and `GET /api/vehicles/:id/drivers` return `[]`.
- `GET /api/vehicles/:id/health/tire-rotation` returns `null`.
- `GET /api/vehicles/:id/history?metric=temp` returns `[]`.
- `GET /api/vehicles/:id/ota/notes/:version` returns `404`.
- Use vehicle-scoped endpoints (`/api/vehicles/:id/drives/:driveId` and
  `/api/vehicles/:id/charging-sessions/:sessionId/curve`) for TeslaMate vehicles; the unscoped
  `/api/drives/:driveId` and `/api/charging-sessions/:sessionId/curve` routes query RivianMate's own
  database only.

---

## Endpoint Reference

### 1. Authentication & Setup

| Method | Path                        | Auth          | Description                                                         |
| ------ | --------------------------- | ------------- | ------------------------------------------------------------------- |
| `GET`  | `/api/status`               | Public        | Application setup, auth, Rivian connection, and TeslaMate status    |
| `POST` | `/api/setup`                | Public        | Create initial app password (first run only) and set session cookie |
| `POST` | `/api/auth/login`           | Public        | Authenticate with app password and set `rivianmate_session` cookie  |
| `POST` | `/api/auth/logout`          | Session       | Clear the `rivianmate_session` cookie                               |
| `POST` | `/api/auth/change-password` | Session       | Change the app password                                             |
| `GET`  | `/api/auth/session`         | Session / Key | Verify current credentials and return auth method & scope           |

#### `GET /api/status`

Public health and bootstrap status. When unauthenticated, `rivianAuthState` and `rivianEmail` are
always `null`.

```json
{
  "needsSetup": false,
  "authed": true,
  "rivianConnected": true,
  "rivianAuthState": "ok",
  "rivianEmail": "owner@example.com",
  "mockMode": false,
  "teslamateConfigured": false,
  "needsLookupChoice": false,
  "signInStartsSetup": false
}
```

#### `POST /api/setup`

- **Body:** `{ "password": "<string, 12-128 chars>" }`
- **Response (`200`):** `{ "ok": true }` + `Set-Cookie: rivianmate_session=...`
- **Errors:** `400` (password policy), `409` (`Already set up`)

#### `POST /api/auth/login`

- **Body:** `{ "password": "<string, 1-1024 chars>" }`
- **Response (`200`):** `{ "ok": true }` + `Set-Cookie: rivianmate_session=...`
- **Errors:** `401` (`Invalid password`), `429` (throttled; includes `Retry-After`)

#### `POST /api/auth/logout`

- **Response (`200`):** `{ "ok": true }` (clears `rivianmate_session` cookie)

#### `POST /api/auth/change-password`

- **Body:** `{ "currentPassword": "<string>", "newPassword": "<string>" }`
- **Response (`200`):** `{ "ok": true }`
- **Errors:** `400` (weak or unchanged password), `401`, `429`

#### `GET /api/auth/session`

- **Response (`200`) with session cookie:** `{ "authed": true, "method": "session" }`
- **Response (`200`) with API key:**
  `{ "authed": true, "method": "api_key", "scope": "read" | "write" }`
- **Errors:** `401` if not authenticated

---

### 2. API Keys

All `/api/api-keys*` endpoints require a **browser session cookie** (`403` when called with an API
key). Up to **50** keys can exist at once.

| Method   | Path                | Description                                                                |
| -------- | ------------------- | -------------------------------------------------------------------------- |
| `GET`    | `/api/api-keys`     | List all API keys (prefixes and metadata only; secrets are never returned) |
| `POST`   | `/api/api-keys`     | Create a new API key and return its secret once                            |
| `DELETE` | `/api/api-keys/:id` | Revoke an API key immediately                                              |

#### `GET /api/api-keys`

- **Response (`200`):** `ApiKeyDto[]` (newest first):
  ```json
  [
    {
      "id": 1,
      "name": "Home Assistant",
      "prefix": "rmk_aBcDeFgH",
      "scope": "read",
      "createdAt": "2026-11-24T21:00:00.000Z",
      "lastUsedAt": "2026-11-24T21:10:00.000Z",
      "expiresAt": null
    }
  ]
  ```

#### `POST /api/api-keys`

- **Body (`CreateApiKeyInput`):**
  - `name`: string, 1–60 chars (trimmed)
  - `scope`: `"read"` | `"write"` (default `"read"`)
  - `expiresAt`: optional ISO 8601 datetime with offset (e.g. `"2027-01-01T00:00:00.000Z"`), or
    `null` for no expiration. Must be in the future.
- **Response (`201 Created`):** `CreatedApiKeyDto` (same fields as `ApiKeyDto` plus
  `"key": "rmk_..."`).
- **Errors:** `400` (invalid input or past expiration), `403` (called with an API key), `409`
  (maximum of 50 keys reached)

#### `DELETE /api/api-keys/:id`

- **Response (`204`):** No content
- **Errors:** `403` (called with an API key), `404` (`API key not found`)

---

### 3. Rivian Account & Diagnostics

| Method | Path                           | Description                                                                   |
| ------ | ------------------------------ | ----------------------------------------------------------------------------- |
| `POST` | `/api/rivian/connect`          | Start Rivian login with email and password                                    |
| `POST` | `/api/rivian/otp`              | Complete pending Rivian MFA verification                                      |
| `POST` | `/api/rivian/disconnect`       | Stop monitoring and delete stored encrypted Rivian tokens                     |
| `GET`  | `/api/rivian/diagnostics`      | Monitor state, WebSocket feed health, orders status, and 24h traffic counters |
| `GET`  | `/api/rivian/feeds/:id/latest` | Last payload/fields received on a specific subscription feed                  |

#### `POST /api/rivian/connect`

- **Body:** `{ "email": "owner@example.com", "password": "..." }`
- **Response (`200`):** `{ "ok": true }` if MFA was not required, or
  `{ "ok": false, "otpRequired": true }` when an OTP code must be submitted via `/api/rivian/otp`.
- **Errors:** `400` (invalid email/missing password), `401` (Rivian rejected credentials), `429`
  (Rivian rate limit)

#### `POST /api/rivian/otp`

- **Body:** `{ "code": "123456" }` (4–10 characters; `000000` when `MOCK_RIVIAN=1`)
- **Response (`200`):** `{ "ok": true }`
- **Errors:** `400` (`Invalid or expired code`), `409` (`No login awaiting OTP; start over`), `401`,
  `429`

#### `POST /api/rivian/disconnect`

Stops the vehicle monitor, clears stored Rivian tokens from PostgreSQL, and clears any pending OTP
state.

- **Response (`200`):** `{ "ok": true }`

#### `GET /api/rivian/diagnostics`

Returns `RivianDiagnosticsResponse`:

- `monitor`:
  `{ running, streamConnected, fallbackPolling, pollingStatus, subscriptions, consecutiveAuthFailures, parallaxMode, parallaxModes, orders }`
- `traffic`:
  `{ since, last24h: { httpRequests, httpErrors, rateLimited, sessionRefreshes, wsConnects, wsReconnects, wsDrops, wsMessages, wsAuthFailures }, cooldownUntil, lastRateLimitedAt, lastSuccessfulRequestAt }`

#### `GET /api/rivian/feeds/:id/latest`

Inspects the most recent data received by a feed ID listed in `monitor.subscriptions.feeds[].id`.
URL-encode `:id` if it contains special characters.

- **Response (`200`):** `FeedLatestData` (`{ feedId, messages, lastArchivedAt? }`)
- **Errors:** `404` (`No such feed`)

---

### 4. Vehicles, Live State & Renders

| Method | Path                             | Description                                                                  |
| ------ | -------------------------------- | ---------------------------------------------------------------------------- |
| `GET`  | `/api/vehicles`                  | List all Rivian and TeslaMate vehicles                                       |
| `GET`  | `/api/vehicles/:id/render/:view` | Proxy and cache vehicle render image (`three-quarter` or `overhead`)         |
| `GET`  | `/api/vehicles/:id/state`        | Latest merged `VehicleState` telemetry snapshot                              |
| `GET`  | `/api/vehicles/:id/live`         | **SSE stream** of live `state` and `charging` updates                        |
| `GET`  | `/api/vehicles/:id/plugged-in`   | Timestamp when the vehicle was plugged in (if currently plugged in)          |
| `GET`  | `/api/vehicles/:id/schedules`    | Vehicle charging schedules and departure/preconditioning schedules           |
| `GET`  | `/api/vehicles/:id/insights`     | Cell temps, cold-weather impact, parked energy, navigation, and connectivity |
| `GET`  | `/api/vehicles/:id/parked-days`  | Daily rolling 24h parked energy breakdown from the Parallax archive          |

#### `GET /api/vehicles`

Returns `VehicleDto[]`:

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

#### `GET /api/vehicles/:id/render/:view`

- **Path params:** `view` must be `three-quarter` or `overhead` (check `vehicle.renders` first).
- **Response (`200`):** Binary image (`image/png`, etc.) with
  `Cache-Control: private, max-age=86400`.
- **Errors:** `404` (`No render`), `502` (`Render unavailable`)

#### `GET /api/vehicles/:id/state`

Returns the latest merged `VehicleState` dictionary. Most properties have the shape
`{ "timeStamp": "<ISO>", "value": <string | number | null> }`, plus three structured fields:

- `cloudConnection`: `{ lastSync: string | null, isOnline: boolean }`
- `gnssLocation`:
  `{ latitude: number, longitude: number, timeStamp: string, isAuthorized?: boolean }`
- `navLocation`: `{ latitude, longitude, timeStamp, speedMps?, bearing? }`

Key properties include `powerState`, `gearStatus`, `driveMode`, `batteryLevel`, `batteryCapacity`,
`batteryLimit`, `distanceToEmpty`, `vehicleMileage` (meters), `chargerState`, `chargerStatus`,
`chargePortState`, `timeToEndOfCharge`, `gnssSpeed` (m/s), `gnssAltitude`, `gnssBearing`,
`cabinClimateInteriorTemperature`, `cabinClimateDriverTemperature`, `activeDriverName`,
`tirePressureFrontLeft`/`FrontRight`/`RearLeft`/`RearRight` (bar), door/window/closure lock and
closed states, `otaCurrentVersion`, `otaAvailableVersion`, and `otaStatus`.

- **Errors:** `404` (`No state yet`) if no telemetry has been received yet.

#### `GET /api/vehicles/:id/plugged-in`

- **Response (`200`):** `{ "pluggedInAt": "2026-11-24T18:00:00.000Z" }` or `{ "pluggedInAt": null }`

#### `GET /api/vehicles/:id/schedules`

- **Response (`200`):** `SchedulesDto`
  (`{ charging, chargingFromParallax, departures, departuresUnavailable, chargingUpdatedAt, departuresUpdatedAt }`).

#### `GET /api/vehicles/:id/insights`

- **Response (`200`):** `VehicleInsightsDto` containing `cellTemps`, `cellTempsCurrent`,
  `coldWeather`, `parkedEnergy`, `navigation` (with saved location names substituted onto matching
  stops/destinations), and `connectivity` (Wi-Fi SSID/RSSI/frequency and cellular carrier/tech).
  Individual sections are `null` until reported.

#### `GET /api/vehicles/:id/parked-days`

- **Query params:**
  - `days`: integer `1–31`, default `7`
  - `tz`: optional IANA time zone (max 64 chars; defaults to server time zone)
- **Response (`200`):** `ParkedDayDto[]` (oldest first; each entry has `day`, `at`, `minutes`,
  `kwh`, `rangeKm`, and `uses: { climate, system, gearGuard, outlets }`).

---

### 5. Orders

| Method | Path                                | Description                                                                         |
| ------ | ----------------------------------- | ----------------------------------------------------------------------------------- |
| `GET`  | `/api/orders`                       | Account vehicle orders, build progress, delivery appointments, and render views     |
| `GET`  | `/api/orders/:orderId/render/:view` | Proxy and cache render image for an ordered vehicle (`three-quarter` or `overhead`) |

#### `GET /api/orders`

- **Response (`200`):** `OrdersDto`:
  - `journeys`: `OrderJourneyDto[]` (`orderId`, `delivered`, `vehicleId`, `state`,
    `fulfillmentSummaryStatus`, `detail: LookupDto<OrderDetail | null>`,
    `delivery: LookupDto<Delivery | null> | null`, `renders: VehicleView[]`)
  - `checkedAt`: ISO timestamp or `null`
  - `refreshMinutes`: polling interval for undelivered orders (`15`)

Lookups use a tagged union `{ "ok": true, "value": ... }` or `{ "ok": false, "error": "..." }` so a
failed lookup is never confused with missing data.

---

### 6. History, Drives & Locations

| Method | Path                                | Description                                                                       |
| ------ | ----------------------------------- | --------------------------------------------------------------------------------- |
| `GET`  | `/api/vehicles/:id/history`         | Time-series history for battery, range, mileage, or pack temp                     |
| `GET`  | `/api/vehicles/:id/charge-spans`    | Intervals when the vehicle was plugged in vs. actively charging                   |
| `GET`  | `/api/vehicles/:id/state-spans`     | Intervals by vehicle state (`driving`, `charging`, `updating`, `awake`, `asleep`) |
| `GET`  | `/api/vehicles/:id/locations`       | Thinned GPS location points over a time range                                     |
| `GET`  | `/api/vehicles/:id/drive-coverage`  | Timestamp of the earliest recorded drive (`{ since }`)                            |
| `GET`  | `/api/vehicles/:id/drives`          | Paginated or windowed list of drives                                              |
| `GET`  | `/api/vehicles/:id/drives/:driveId` | Full drive detail with route points (Rivian & TeslaMate)                          |
| `GET`  | `/api/drives/:driveId`              | Full drive detail with route points (Rivian only)                                 |
| `GET`  | `/api/vehicles/:id/drivers`         | Known drivers for a vehicle                                                       |
| `PUT`  | `/api/drives/:driveId/driver`       | Manually assign or clear a drive's driver                                         |

#### `GET /api/vehicles/:id/history`

- **Query params:**
  - `metric`: `battery` | `range` | `mileage` | `temp` (default `battery`)
  - `from`: ISO 8601 date (default: 7 days ago)
  - `to`: ISO 8601 date (default: now; clamped to current time)
  - `bucket`: `raw` | `5m` | `15m` | `1h` | `6h` | `1d` (default `1h`)
- **Response (`200`):** `HistoryPoint[]` (`{ bucket, avg, min, max }`). For `temp`,
  `avg`/`min`/`max` are pack cell temperatures (°C) and an all-null row marks a gap while asleep.

#### `GET /api/vehicles/:id/charge-spans` and `/api/vehicles/:id/state-spans`

- **Query params:** `from` (ISO date, default 24h ago), `to` (ISO date, default now)
- **Response (`200`):**
  - `charge-spans`: `ChargeSpanDto[]` (`{ kind: "charging" | "plugged", from, to }`)
  - `state-spans`: `StateSpanDto[]`
    (`{ state: "driving" | "charging" | "updating" | "awake" | "asleep", from, to }`)

#### `GET /api/vehicles/:id/locations`

- **Query params:** `from` (ISO date, default 24h ago), `to` (ISO date, default now)
- **Response (`200`):** `LocationPointDto[]`
  (`{ ts, lat, lon, speedKmh, bearing, altitude, driveId }`), automatically time-bucketed and
  Douglas-Peucker thinned for longer windows.

#### `GET /api/vehicles/:id/drives`

- **Query params:** Standard [list window](#pagination--list-windows) (`from`, `to`, `before`,
  `after`).
- **Response (`200`):** `DriveDto[]`, newest first. Finished drives shorter than `0.1 km` are
  excluded; in-progress drives (`endedAt: null`) reflect live figures so far.

#### `GET /api/vehicles/:id/drives/:driveId` (and `GET /api/drives/:driveId`)

- **Response (`200`):** `DriveDetailDto` (`DriveDto` plus `points: LocationPointDto[]` with every
  recorded GPS point along the route; anomalous speed spikes are nulled out).
- **Errors:** `404` (`Not found`)

#### `GET /api/vehicles/:id/drivers`

- **Response (`200`):** `DriverDto[]` (`{ id, name }`).

#### `PUT /api/drives/:driveId/driver`

Overrides who drove a recorded Rivian drive (manual overrides are preserved and never overwritten by
profile detection).

- **Body:** `{ "driverId": 2 }` or `{ "driverId": null }` to clear
- **Response (`204`):** No content
- **Errors:** `400` (`Not one of this vehicle's drivers`), `404` (`Not found`)

---

### 7. Charging & Wallboxes

| Method  | Path                                                   | Description                                               |
| ------- | ------------------------------------------------------ | --------------------------------------------------------- |
| `GET`   | `/api/vehicles/:id/charging-sessions`                  | Paginated or windowed list of charging sessions           |
| `GET`   | `/api/vehicles/:id/charging-coverage`                  | Timestamp of the earliest charging session (`{ since }`)  |
| `GET`   | `/api/vehicles/:id/charging-sessions/:sessionId/curve` | Power & SoC charging curve (Rivian & TeslaMate)           |
| `GET`   | `/api/charging-sessions/:sessionId/curve`              | Power & SoC charging curve (Rivian only)                  |
| `PATCH` | `/api/charging-sessions/:sessionId`                    | Set or clear a charging session's cost                    |
| `GET`   | `/api/wallboxes`                                       | Registered Rivian Wall Chargers and their latest readings |

#### `GET /api/vehicles/:id/charging-sessions`

- **Query params:** Standard [list window](#pagination--list-windows) (`from`, `to`, `before`,
  `after`).
- **Response (`200`):** `ChargingSessionDto[]`, newest first. Includes `startSoc`, `endSoc`,
  `chargingSeconds`, `chargingStartedAt`, `chargingEndedAt`, `energyKwh`, `packKwh`, `thermalKwh`,
  `estimatedEnergyKwh`, `avgPowerKw`, `maxPowerKw`, `cost`, `estimatedCost`, `currency`, `isHome`,
  `location`, `socLimit`, `source`, `vendor`, and `city`.

#### `GET /api/vehicles/:id/charging-sessions/:sessionId/curve`

- **Response (`200`):** `ChargingCurvePointDto[]` (`{ ts, powerKw, soc, projected?, estimated? }`).
  While a session is actively charging, trailing points with `projected: true` represent Rivian's
  forecast (or RivianMate's estimate when `estimated: true`).

#### `PATCH /api/charging-sessions/:sessionId`

- **Body:** `{ "cost": "12.50" }` or `{ "cost": 12.5 }` or `{ "cost": null }` (reverts to rate-based
  estimate)
- **Response (`200`):** Updated `ChargingSessionDto`
- **Errors:** `404` (`Not found`)

#### `GET /api/wallboxes`

- **Response (`200`):** `WallboxDto[]` including metadata (`wallboxId`, `name`, `model`,
  `serialNumber`, `softwareVersion`, `maxAmps`, `maxPower`, `latitude`, `longitude`) and `latest`
  reading (`ts`, `chargingStatus`, `power`, `currentVoltage`, `currentAmps`).

---

### 8. Vehicle Health & OTA Updates

| Method | Path                                     | Description                                                        |
| ------ | ---------------------------------------- | ------------------------------------------------------------------ |
| `GET`  | `/api/vehicles/:id/battery-window`       | Battery start/end levels and parked loss over a window             |
| `GET`  | `/api/vehicles/:id/health/phantom-drain` | Daily parked/unplugged battery drain (`%/day`)                     |
| `GET`  | `/api/vehicles/:id/health/tires`         | Bucketed tire pressures (bar) over N days                          |
| `GET`  | `/api/vehicles/:id/health/tire-rotation` | Wheel rotation reminder from Parallax (`odometerKm`, `intervalKm`) |
| `GET`  | `/api/vehicles/:id/health/battery`       | Reported usable pack capacity history and rated capacity           |
| `GET`  | `/api/vehicles/:id/ota`                  | Current, available, pending, and historical OTA software versions  |
| `GET`  | `/api/vehicles/:id/ota/notes/:version`   | Saved release notes PDF for a software version                     |

#### `GET /api/vehicles/:id/battery-window`

- **Query params:** `from` (**required**, ISO date), `to` (optional ISO date, default now)
- **Response (`200`):** `BatteryWindowDto`
  (`{ capacityKwh, startLevel, endLevel, parkedLossPct, parkedHours }`)

#### `GET /api/vehicles/:id/health/phantom-drain`

- **Query params:**
  - `days`: integer `1–365`, default `30`
  - `tz`: optional IANA time zone (max 64 chars, default `UTC`)
- **Response (`200`):** `PhantomDrainDto`
  (`{ days: [{ day, lossPct, parkedHours, pctPerDay }], avgPctPerDay }`)

#### `GET /api/vehicles/:id/health/tires`

- **Query params:** `days`: integer `1–365`, default `30` (auto-bucketed: `1h` for ≤7d, `6h` for
  ≤30d, `24h` for >30d)
- **Response (`200`):** `TirePressurePointDto[]`
  (`{ ts, frontLeft, frontRight, rearLeft, rearRight }`, values in **bar**)

#### `GET /api/vehicles/:id/health/tire-rotation`

- **Response (`200`):** `TireRotationDto | null`
  (`{ odometerAtLastRotationKm, intervalKm, odometerKm, at }`; `intervalKm: 0` means reminder
  disabled).

#### `GET /api/vehicles/:id/health/battery`

- **Response (`200`):** `BatteryHealthDto`
  (`{ latest, reported: [{ day, at, kwh }], ratedCapacity }`)

#### `GET /api/vehicles/:id/ota`

- **Response (`200`):** `OtaTimelineDto`
  (`{ current, available, versions: [{ version, firstSeen, hasNotes }], pending, lastInstall }`)

#### `GET /api/vehicles/:id/ota/notes/:version`

- **Response (`200`):** `application/pdf` (`Content-Disposition: inline`,
  `Cache-Control: private, max-age=86400`)
- **Errors:** `404` (`text/plain`) if release notes were not captured for that version

---

### 9. Trips

Trips group finished drives and charging sessions for a vehicle. A trip with `startDate` (and
optional `endDate`) automatically collects finished drives and charges starting on those calendar
days when trip endpoints are read (at most once every 30 seconds per vehicle, or immediately after
any trip edit). Removing an activity records an exclusion so dated trips never re-add it.

| Method   | Path                                                           | Description                                                              |
| -------- | -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `GET`    | `/api/vehicles/:id/trips`                                      | List trips with aggregated stats (newest first)                          |
| `POST`   | `/api/vehicles/:id/trips`                                      | Create a trip                                                            |
| `GET`    | `/api/vehicles/:id/trips/:tripId`                              | Trip detail with stats, drives, and charging sessions                    |
| `PATCH`  | `/api/vehicles/:id/trips/:tripId`                              | Update trip name, notes, or dates                                        |
| `DELETE` | `/api/vehicles/:id/trips/:tripId`                              | Delete a trip (keeps underlying drives and charges)                      |
| `POST`   | `/api/vehicles/:id/trips/:tripId/activities`                   | Add, move, or exclude drives/charges on a trip                           |
| `DELETE` | `/api/vehicles/:id/trips/:tripId/activities/:kind/:activityId` | Remove and exclude one drive or charge from a trip                       |
| `GET`    | `/api/vehicles/:id/trips/:tripId/route`                        | Thinned route coordinates and elevation profiles for a trip's drives     |
| `GET`    | `/api/vehicles/:id/trip-assignments`                           | Map of all activities currently assigned to any trip for the vehicle     |
| `GET`    | `/api/vehicles/:id/trip-candidates`                            | Finished drives/charges in a date range, plus assignments and exclusions |

#### `POST /api/vehicles/:id/trips` and `PATCH /api/vehicles/:id/trips/:tripId`

- **Body (`TripInput`; partial on `PATCH`):**
  - `name`: string, 1–120 chars (required on `POST`)
  - `notes`: string (max 5000 chars) or `null`
  - `startDate`: `YYYY-MM-DD` or `null`
  - `endDate`: `YYYY-MM-DD` or `null` (must be `>= startDate`)
  - `timeZone`: valid IANA time zone or `null` (**required** whenever `startDate` is set)
- **Response:** `201 Created` (`POST`) or `200 OK` (`PATCH`) with `TripDto`
- **Errors:** `400` (invalid dates/missing timeZone), `404` (unknown vehicle or trip), `409` (date
  range overlaps another trip for the same vehicle)

#### `POST /api/vehicles/:id/trips/:tripId/activities`

- **Body:**
  ```json
  {
    "items": [
      { "kind": "drive", "id": 42 },
      { "kind": "charge", "id": 15 }
    ],
    "move": false,
    "exclude": []
  }
  ```
  - `items` and `exclude`: arrays of `{ kind: "drive" | "charge", id: <positive int> }` (max 1000
    each; combined length must be `>= 1`).
  - `move`: boolean (default `false`). When `true`, activities already in another trip are moved
    (and excluded from the old trip); when `false`, conflicting activities return `409`.
- **Response (`204`):** No content
- **Errors:** `400` (unfinished or non-matching activities), `404`, `409` (already assigned)

#### `DELETE /api/vehicles/:id/trips/:tripId/activities/:kind/:activityId`

- **Path params:** `kind` is `drive` or `charge`; `activityId` is a positive integer.
- **Response (`204`):** No content

#### `GET /api/vehicles/:id/trip-candidates`

- **Query params:** `from` (**required**, ISO date), `to` (**required**, ISO date), `tripId`
  (optional positive integer to include that trip's `excluded` list)
- **Response (`200`):** `TripCandidatesDto` (`{ drives, sessions, assignments, excluded }`)

---

### 10. Saved Locations & Geocoding

| Method   | Path                  | Description                                  |
| -------- | --------------------- | -------------------------------------------- |
| `GET`    | `/api/locations`      | List all saved locations                     |
| `POST`   | `/api/locations`      | Create a saved location                      |
| `PUT`    | `/api/locations/:id`  | Update a saved location                      |
| `DELETE` | `/api/locations/:id`  | Delete a saved location                      |
| `GET`    | `/api/geocode/search` | Search addresses via OpenStreetMap Nominatim |

#### `POST /api/locations` and `PUT /api/locations/:id`

- **Body (`SavedLocationInput`):**
  ```json
  {
    "name": "Home",
    "lat": 40.5142,
    "lon": -88.9906,
    "radiusM": 150,
    "isHome": true,
    "ratePerKwh": 0.14
  }
  ```
  - `name`: 1–40 chars (trimmed)
  - `lat`: `-90` to `90`; `lon`: `-180` to `180`
  - `radiusM`: integer `25` to `1000` (meters)
  - `isHome`: boolean (used for home-charging classification and "away only" notifications)
  - `ratePerKwh`: number `0` to `10`, or `null` (no cost estimate; `0` = free)
- **Response:** `201 Created` (`POST`) or `200 OK` (`PUT`) with `SavedLocation` (adds `id`).

#### `DELETE /api/locations/:id`

- **Response (`204`):** No content (`404` if not found)

#### `GET /api/geocode/search`

- **Query params:** `q` (**required**, 3–200 chars), optional `lat` (`-90..90`) and `lon`
  (`-180..180`) to bias results nearby
- **Response (`200`):** `GeocodeResultDto[]` (`{ label, lat, lon }`)
- **Errors:** `502` (`Search is unavailable right now`)

---

### 11. Settings, Notifications & TeslaMate

| Method   | Path                               | Description                                                            |
| -------- | ---------------------------------- | ---------------------------------------------------------------------- |
| `GET`    | `/api/version`                     | Server package version and Docker build git commit SHA                 |
| `GET`    | `/api/settings/units`              | Display unit preferences                                               |
| `PUT`    | `/api/settings/units`              | Update display unit preferences                                        |
| `GET`    | `/api/settings/charging`           | Charging currency setting                                              |
| `PUT`    | `/api/settings/charging`           | Update charging currency setting                                       |
| `GET`    | `/api/settings/lookups`            | External address & weather lookup settings                             |
| `PUT`    | `/api/settings/lookups`            | Update external lookup settings (and complete first-run lookup choice) |
| `GET`    | `/api/settings/notifications`      | Notification destinations (redacted previews) and event rules          |
| `PUT`    | `/api/settings/notifications`      | Replace notification settings and destinations                         |
| `POST`   | `/api/settings/notifications/test` | Send a test alert to every configured destination                      |
| `GET`    | `/api/settings/teslamate`          | TeslaMate integration status, redacted preview, and vehicles           |
| `PUT`    | `/api/settings/teslamate`          | Test and save encrypted TeslaMate PostgreSQL URL                       |
| `DELETE` | `/api/settings/teslamate`          | Disconnect and remove TeslaMate database URL                           |

#### Settings Payloads

- **`/api/version`:** `{ "version": "0.12.0", "commit": "<sha or null>" }`
- **`/api/settings/units`:** `{ "distance": "mi" | "km", "temperature": "F" | "C" }`
- **`/api/settings/charging`:** `{ "currency": "USD" }` (3 uppercase ISO 4217 letters,
  `/^[A-Z]{3}$/`)
- **`/api/settings/lookups`:** `{ "addresses": true, "weather": true }`

#### Notifications (`/api/settings/notifications`)

- Up to **10** destinations (`kind`: `"apprise"` | `"discord"`). Webhook/Apprise URLs are stored
  encrypted with `APP_SECRET` and never returned in full—`GET` returns a redacted `preview` instead.
- On `PUT /api/settings/notifications`, pass the full `destinations` array:
  - Include an existing `id` **without** `url` to keep the saved secret (you can still rename it).
  - Provide `url` to add a new destination or replace an existing URL.
  - Omit a saved `id` to delete it.
- `events` configures:
  - Timed alerts (`{ enabled, minutes: 1..1440, awayOnly }`): `doorOpen`, `windowOpen`, `unlocked`
  - Toggle alerts (`{ enabled }`): `tirePressure`, `updateAvailable`, `updateInstalled`,
    `updateFailed`, `chargingComplete`
  - Threshold alert (`{ enabled, percent: 1..90 }`): `lowBattery`
- `appUrl`: optional `http://` or `https://` base URL (max 512 chars) used for links in alerts.
- `POST /api/settings/notifications/test` returns `NotificationTestResult[]`
  (`{ id, kind, name, ok, error }`).

#### TeslaMate (`/api/settings/teslamate`)

- **`PUT` body:** `{ "url": "postgres://teslamate:password@host:5432/teslamate" }` (max 2048 chars).
  RivianMate tests read-only connectivity before encrypting and saving the URL. Returns `400` on an
  invalid URL or connection failure.
- **`GET` / `PUT` / `DELETE` response (`200`):** `TeslaMateSettingsDto`
  (`{ configured, preview, connected, error, lastReadAt, vehicles }`).

---

### 12. Data Imports

Imports historical drives, charging sessions, and state history from **ElectraFi** (`.csv`,
`.csv.gz`) or **Rivian Roamer** (`.zip`) exports in a three-step workflow: upload files into a draft
→ preview → start background import.

| Method   | Path                      | Description                                                    |
| -------- | ------------------------- | -------------------------------------------------------------- |
| `GET`    | `/api/imports`            | Current upload draft (if any) and history of import batches    |
| `POST`   | `/api/imports/files`      | Upload one raw binary export file into a new or existing draft |
| `DELETE` | `/api/imports/drafts/:id` | Discard an upload draft and delete its temp files              |
| `POST`   | `/api/imports/preview`    | Dry-run an import for a vehicle and date range                 |
| `POST`   | `/api/imports`            | Start an asynchronous import batch (`202 Accepted`)            |
| `DELETE` | `/api/imports/:id`        | Undo a completed import batch (keeps drivers and saved places) |

#### `POST /api/imports/files`

- **Required header:** `Content-Type: application/octet-stream` (returns `415` otherwise)
- **Body:** Raw file bytes (streamed; max **1 GiB** per file, max **240** files per draft)
- **Query params:**
  - `format`: `electrafi` | `roamer` (default `electrafi`)
  - `name`: filename (default `export`, max 1000 chars)
  - `draft`: optional draft ID returned by a previous upload to append more files
- **Response (`200`):** `ImportDraftDto` (`{ id, format, files, vehicleIds }`)

#### `POST /api/imports/preview` and `POST /api/imports`

- **Body:**
  ```json
  {
    "draftId": "...",
    "vehicleId": "01-123456789",
    "timeZone": "America/New_York",
    "from": "2025-01-01",
    "to": "2025-12-31"
  }
  ```
- **Preview response (`200`):** `ImportPreviewDto` (counts of new/recorded/newer drives, charges,
  enrichments, readings, places, warnings, and per-item previews).
- **Start response (`202 Accepted`):** `ImportBatchDto` (`status`: `"running"` | `"done"` |
  `"failed"`, `progress`: `0..1`, `counts`, `error`). Poll `GET /api/imports` to track progress.

---

### 13. Server Logs

| Method | Path               | Description                                          |
| ------ | ------------------ | ---------------------------------------------------- |
| `GET`  | `/api/logs/stream` | **SSE stream** of recent and live server log entries |

Returns redacted structured log entries (tokens, passwords, email, and vehicle locations are
excluded).

---

## Server-Sent Events (SSE)

RivianMate exposes two SSE endpoints:

| Endpoint                     | Initial Events                                                             | Ongoing Events                                                   |
| ---------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `GET /api/vehicles/:id/live` | `:ok`, `state` (if state exists), `charging` (`LiveSessionData \| null`)   | `state` (`VehicleState`), `charging` (`LiveSessionData \| null`) |
| `GET /api/logs/stream`       | `:ok`, `backlog` (`LogBacklogDto`, up to 2,000 recent lines + `LOG_LEVEL`) | `log` (`LogEntryDto`)                                            |

Both streams:

- Return `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`,
  `X-Accel-Buffering: no`.
- Send a `:ka` comment frame every **25 seconds** to keep connections alive through proxies.
- Do not support `Last-Event-ID` replay; reconnecting receives the full current state snapshot (or
  log backlog).

### Streaming with `curl`

```sh
curl -N -H "Authorization: Bearer $API_KEY" https://rivianmate.example.com/api/vehicles/<vehicleId>/live
```

Example frames:

```text
:ok

event: state
data: {"cloudConnection":{"lastSync":"2026-11-24T19:15:00Z","isOnline":true},"batteryLevel":{"timeStamp":"2026-11-24T19:15:00Z","value":78}}

event: charging
data: null

:ka
```

---

## Current Limitations

Keep these current limitations in mind when building integrations:

- **No CORS configuration:** Cross-origin browser requests are not supported directly; use
  server-to-server calls or a same-origin proxy.
- **No OpenAPI / Swagger schema yet:** Use [`server/src/api-types.ts`](../server/src/api-types.ts)
  as the source of truth for TypeScript payload shapes.
- **No API versioning:** Paths live under `/api/*` and evolve with RivianMate releases. Check
  [CHANGELOG.md](../CHANGELOG.md) when upgrading.
