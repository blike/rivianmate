# RivianMate Plan

## Goal

Build a self-hosted data logger and dashboard app for Rivian vehicles, similar in spirit to TeslaMate but tailored to Rivian's unofficial API surface and without a Grafana dependency.

The app should:

- Authenticate to a Rivian account with MFA support.
- Discover one or more vehicles and wallboxes.
- Collect live vehicle state, charging sessions, trips, sleep/online state, software updates, and health signals.
- Store normalized telemetry in PostgreSQL with query-friendly rollups.
- Provide built-in dashboards for drives, charging, efficiency, battery health, location history, and status.
- Preserve vehicle sleep and account safety by default.

## References Checked

- TeslaMate GitHub: https://github.com/teslamate-org/teslamate
- TeslaMate docs: https://docs.teslamate.org
- Rivian Home Assistant integration: https://github.com/bretterer/home-assistant-rivian
- Rivian Python client used by that integration: https://github.com/bretterer/rivian-python-client

Important observations:

- TeslaMate is an Elixir/Postgres self-hosted logger with Grafana dashboards, MQTT publishing, geofences, multiple vehicles, charge cost tracking, and sleep-aware logging.
- Rivian's current unofficial HA integration uses `rivian-python-client[ble]`, GraphQL, a WebSocket subscription for vehicle state, and separate fetchers for charging session, driver/key, wallbox, and vehicle-image data.
- The HA integration treats vehicle state as subscription-first: its `VehicleCoordinator` raises on polling vehicle state and subscribes to live updates instead.
- Charging session data is fetched separately and uses a fast interval when plugged in and a slow interval when unplugged.
- The integration warns users to use MFA and a dedicated invited driver account where possible.

## Non-Goals

- No Grafana integration for MVP.
- No MQTT for MVP unless needed later for Home Assistant or automation users.
- No remote vehicle control in MVP. Logging and read-only visibility come first.
- No reverse-engineering beyond what is necessary to interoperate with the user's own account and vehicle.
- No copying TeslaMate implementation or database schema verbatim. It is AGPL-licensed and should be treated as product inspiration only.

## Product Shape

RivianMate should be a single web app with background workers:

- `web`: TypeScript API server and dashboard UI.
- `collector`: long-lived worker per account/vehicle for Rivian auth, subscriptions, and scheduled fetches.
- `jobs`: rollups, geocoding, data repair, retention tasks, and optional imports/exports.
- `postgres`: primary datastore.
- `redis` or Postgres advisory locks: optional queue/coordination layer. Prefer Postgres-only for MVP unless background job needs justify Redis.

Product decisions:

- Local, single-user app.
- Docker Compose is the target installation path.
- PostgreSQL only for the MVP; do not require PostGIS initially.
- Exact location history is stored indefinitely by default for trip tracking.
- Remote vehicle controls are out of scope.
- Home Assistant integration may be added later, likely via MQTT, webhooks, or a read-only API.

Recommended stack:

- Runtime: Node.js 22+.
- Language: TypeScript.
- Web/API: Fastify or NestJS. Fastify is lighter and a good MVP default.
- UI: Next.js or Vite React. If API and UI stay together, Next.js App Router is convenient; if collector is the main complexity, Vite + Fastify keeps boundaries simple.
- DB access: Drizzle ORM or Prisma. Drizzle is a good fit for Postgres-specific tables, migrations, and explicit SQL.
- Charts: Apache ECharts or Recharts. ECharts is better for dense time-series dashboards.
- Maps: MapLibre GL with OpenStreetMap tiles or user-configurable tile provider.
- Auth/session: local admin account for MVP; later OIDC/reverse-proxy auth.
- Deployment: Docker Compose with app and Postgres services.

## API Integration Strategy

Build a TypeScript Rivian API client rather than shelling out to Python:

- Port the known public behavior from the Apache-licensed Rivian Python client conceptually.
- Keep the client isolated in `packages/rivian-api`.
- Make API field selections explicit and versioned.
- Store raw responses/events for replay when parsers change.
- Implement strict rate limiting, exponential backoff, and circuit breakers.
- Refresh tokens automatically; surface re-auth required in the UI.
- Redact sensitive IDs/tokens from logs.

Core flows:

1. Create CSRF/app session token.
2. Authenticate with username/password.
3. If MFA is required, prompt for OTP and complete login.
4. Store encrypted access, refresh, and user session tokens.
5. Fetch current user and vehicle list.
6. Open GraphQL WebSocket subscription for vehicle state fields.
7. Fetch live charging session data on an adaptive interval.
8. Fetch driver/key, wallbox, software/image metadata less frequently.

Vehicle state fields to prioritize:

- Location: `gnssLocation`, `gnssSpeed`, `gnssBearing`, `gnssAltitude`.
- Battery/range: `batteryLevel`, `batteryLimit`, `batteryCapacity`, `distanceToEmpty`.
- Power/sleep: `powerState`, cloud connection indicators.
- Charging: `chargerState`, `chargerStatus`, `chargePortState`, `timeToEndOfCharge`.
- Climate: cabin temperature, outside temperature if available, preconditioning status.
- Drive state: `gearStatus`, `driveMode`, trailer/towing signals.
- Health: tire pressure, 12V battery health, thermal statuses, brake fluid low.
- OTA: current/available version and install progress.

Charging session fields to prioritize:

- `startTime`
- `timeElapsed`
- `totalChargedEnergy`
- `rangeAddedThisSession`
- `kilometersChargedPerHour`
- `power`
- `currentPrice`
- `currentCurrency`

## Data Model

Use normalized event tables plus aggregate session tables. Raw events make the system resilient when field semantics change; aggregate tables make dashboards fast.

### Core Tables

- `accounts`
  - local RivianMate user/account metadata.
- `rivian_credentials`
  - encrypted access/refresh/user session tokens, token status, last refresh time.
- `vehicles`
  - Rivian vehicle id, VIN, name, model, trim, year, software version, capabilities, first/last seen.
- `wallboxes`
  - wallbox id, name, serial, status metadata.
- `vehicle_snapshots`
  - append-only parsed state snapshots from subscription updates.
  - indexed by `(vehicle_id, observed_at)`.
  - contains common typed columns plus `raw jsonb`.
- `vehicle_raw_events`
  - source, payload, received_at, parser_version, dedupe hash.
- `vehicle_states`
  - online/asleep/offline/standby/go intervals.
- `positions`
  - timestamp, lat/lon, altitude, speed, bearing, odometer if available, vehicle_id, drive_id.
- `drives`
  - start/end timestamps, start/end positions, distance, duration, max/avg speed, energy estimate, efficiency, start/end SoC/range, geofence refs.
- `charging_sessions`
  - start/end timestamps, plugged/charging intervals, energy delivered, range added, start/end SoC, cost, currency, geofence/location.
- `charging_samples`
  - timestamp, power, current, voltage if available, energy delivered, session id.
- `geofences`
  - name, lat/lon, radius, optional charge cost defaults.
- `addresses`
  - reverse-geocoded address cache.
- `software_updates`
  - current/available versions, install events, progress history.
- `health_samples`
  - tire pressure, 12V health, thermal statuses, service flags.
- `data_quality_events`
  - gaps, parser failures, rate limits, subscription reconnects.

### Postgres Features

- Use `timestamptz` everywhere.
- Use `jsonb` for raw payloads and less-stable fields.
- Use plain latitude/longitude columns and app-side haversine/geofence calculations for MVP. PostGIS can be an optional future upgrade.
- Use BRIN indexes on large time-series tables.
- Partition `vehicle_snapshots`, `positions`, and `charging_samples` monthly once volume warrants it.
- Add unique/dedupe constraints based on vehicle, source timestamp, source field, and payload hash.

## State Machine

Collector state should derive high-level sessions from incoming events:

- `sleep/offline/online` state intervals from `powerState` and cloud connection.
- `drive` starts when vehicle is in gear/moving or location speed crosses a small threshold.
- `drive` ends after parked/stationary for a configurable grace period.
- `charging_session` starts when plugged in or charger state indicates connecting/charging.
- `charging_session` ends after unplugged or session data stops advancing for a grace period.
- `idle` samples are stored at a lower cadence to avoid noisy data growth.

Design for repair:

- Sessionization should be replayable from raw events.
- Derived sessions should include confidence flags.
- UI should expose gaps and suspicious sessions.

## Dashboards

MVP dashboards should be native app pages:

- Overview: current vehicle status, range, SoC, charging, sleep state, location, last update.
- Drives: trip list, map trace, distance, duration, efficiency, start/end SoC, temperatures.
- Charging: active session, historical sessions, cost, power curve, energy delivered, location.
- Efficiency: distance and consumption over time, by drive mode, temperature, elevation, route.
- Battery: SoC/range history, estimated full-pack range trends, battery capacity signals if reliable.
- Locations: geofences, visited places, address cache, lifetime map.
- Health: tire pressure, 12V health, thermal warnings, OTA history.
- Data Quality: collector status, API errors, rate-limit backoff, missing data windows.
- Settings: credentials, MFA re-auth, vehicles enabled, polling/subscription policy, units, privacy.

Mobile matters because vehicle dashboards are often checked quickly. Keep dense views available on desktop but make current status and active charging excellent on phone.

## MVP Scope

### Phase 0: Spike

- Create TypeScript Rivian API client spike.
- Authenticate with MFA.
- Fetch user/vehicles.
- Open vehicle-state subscription.
- Fetch live charging session.
- Save raw events to Postgres.
- Prove reconnection/backoff behavior.

### Phase 1: Logger MVP

- Docker Compose setup.
- Local admin auth.
- Encrypted token storage.
- Vehicle discovery.
- Vehicle snapshot ingestion.
- Charging session ingestion.
- Basic drive/session derivation.
- Basic dashboard pages: Overview, Drives, Charging, Data Quality.

### Phase 2: Useful Daily Driver

- Geofences and reverse geocoding.
- Charge cost tracking.
- Software update history.
- Battery/range trend dashboard.
- CSV export.
- Data repair/replay tools.
- Multi-vehicle polish.

### Phase 3: Community Features

- Import/export backups.
- Home Assistant/MQTT optional integration.
- Advanced analytics.
- Plugin-style dashboard cards.
- Read-only API for mobile apps and automations.

## Repository Shape

Suggested monorepo:

```text
apps/
  web/                 # Dashboard UI and API routes
  collector/           # Rivian collectors and workers
packages/
  rivian-api/          # TypeScript Rivian API client
  db/                  # Schema, migrations, query helpers
  domain/              # Sessionization and analytics logic
  ui/                  # Shared UI components
docs/
  rivianmate-plan.md
docker-compose.yml
```

## Security And Privacy

- Treat tokens, VINs, exact locations, and raw payloads as sensitive.
- Encrypt tokens at rest with an app secret supplied via environment variable.
- Redact logs by default.
- Store location indefinitely for trip tracking, with future export redaction and map privacy features as optional enhancements.
- Encourage a dedicated invited Rivian driver account with MFA.
- Default to read-only API usage.
- Do not implement remote controls.

## Risks

- Rivian API is unofficial and may change without notice.
- WebSocket subscription requirements may change.
- Aggressive polling could trigger rate limits or account lock/quarantine.
- Some fields may be unavailable by model year, trim, region, firmware, or account role.
- Odometer and energy-consumption signals may be limited or absent; efficiency may need estimates.
- Remote-control APIs require pairing/private-key handling and are intentionally out of scope.

## Resolved Questions

1. RivianMate is local single-user.
2. Docker Compose is the target install path.
3. Remote controls are out of scope.
4. Home Assistant integration is a potential later feature.
5. Plan for plain PostgreSQL first.
6. Store exact location history forever by default.
7. Next step is detailed product specs before implementation.

See [product-spec.md](product-spec.md) for detailed product behavior.
