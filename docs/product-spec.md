# RivianMate Product Spec

## Summary

RivianMate is a local, single-user, Docker Compose app for logging and visualizing Rivian vehicle data. It is inspired by TeslaMate's self-hosted ownership analytics, but it uses TypeScript, PostgreSQL, and native in-app dashboards instead of Grafana.

The first product should feel like a practical vehicle notebook that quietly records trips, charging, range, locations, and health signals without waking the vehicle unnecessarily or putting the user's Rivian account at risk.

## Product Principles

- Read-only first: never send vehicle commands.
- Local by default: the app runs on the owner's machine or server and stores data in local Postgres.
- Durable history: store exact trip/location history indefinitely unless the user deletes it.
- Transparent collection: show collector health, gaps, rate limits, and last successful sync.
- Fast current status: opening the app should immediately answer "where is my vehicle, how much range does it have, and what is it doing?"
- Dense but calm dashboards: make repeated owner workflows efficient, not flashy.

## Target User

The first user is a technical Rivian owner who is comfortable running Docker Compose and wants long-term visibility into vehicle behavior:

- Trip history with maps.
- Charging history and cost.
- Battery/range trends.
- Current status outside the Rivian mobile app.
- A local datastore they control.

## Installation Experience

The supported MVP install path is Docker Compose.

The repo should provide:

- `.env.example` with all required settings.
- `docker-compose.yml` with app and Postgres services.
- Persistent Postgres volume.
- App secret for token encryption.
- Clear first-run URL, expected port, and reset instructions.
- Health checks for app and database.

Out of scope:

- Native package installers.
- Cloud-hosted service.
- Multi-user or team administration.
- Kubernetes/Helm.

## First-Run Setup

### Goals

The user should go from a fresh Docker Compose install to seeing a discovered vehicle with current status.

### Flow

1. User opens the app.
2. App prompts to create a local admin password.
3. App explains that RivianMate is unofficial, local, read-only, and stores data in the local database.
4. User enters Rivian username and password.
5. If MFA is required, app prompts for the OTP.
6. App authenticates, stores encrypted tokens, and discovers vehicles.
7. User selects which vehicles to log.
8. App starts the collector.
9. App lands on Overview.

### Required States

- Empty install.
- Admin password created.
- Rivian credentials pending.
- MFA required.
- Authentication failed.
- Rate limited or temporarily locked.
- Vehicles discovered.
- No delivered/eligible vehicles found.
- Collector starting.
- Collector healthy.

## Navigation

Primary navigation:

- Overview
- Drives
- Charging
- Battery
- Locations
- Health
- Data Quality
- Settings

Secondary or later navigation:

- Efficiency
- Software
- Exports
- Home Assistant

## Overview

### Purpose

Give the owner a quick current-status answer.

### Required Content

- Vehicle selector if more than one vehicle is enabled.
- Vehicle name, model, VIN suffix, current software version.
- Last update timestamp and collector status.
- Battery SoC, estimated range, charge limit.
- Current power state: sleep, standby, ready, go, offline, unknown.
- Charging state: unplugged, plugged in, charging, complete, unavailable.
- Current/last known location map.
- Cabin temperature and outside temperature if available.
- Gear state, speed, and drive mode if moving.
- Active alerts/health flags.

### Active Charging State

When charging, show:

- Charging power.
- Energy delivered.
- Range added.
- Time elapsed.
- Estimated time remaining.
- Cost and currency if reported.
- Charge curve mini chart.

### Empty and Error States

- No vehicle selected.
- Waiting for first vehicle update.
- Subscription disconnected.
- Credentials expired.
- API rate-limited.
- Last data stale.

## Drives

### Purpose

Browse and inspect recorded trips.

### List View

Each drive row should show:

- Start and end time.
- Start and end location names, geofence names, or coordinates.
- Distance.
- Duration.
- Start and end SoC/range.
- Max speed and average speed if available.
- Estimated efficiency if available.
- Data confidence indicator if the drive has gaps.

Filters:

- Date range.
- Vehicle.
- Start/end geofence.
- Minimum distance.
- Data quality.

### Detail View

Each drive detail should show:

- Route map with sampled path.
- Timeline chart for speed, battery level, estimated range, altitude, and temperature where available.
- Summary stats.
- Start/end snapshots.
- Raw data gap warnings.
- Link to nearby charging sessions if relevant.

### Sessionization Rules

Drive starts when:

- Vehicle reports moving/in use, or
- Gear is Drive/Reverse and speed or location changes, or
- Speed crosses a configurable threshold.

Drive ends when:

- Vehicle is parked/stationary for a grace period, or
- Power state indicates sleep/offline after movement, or
- No movement updates arrive for a longer timeout.

Derived drives must be replayable from raw events.

## Charging

### Purpose

Track charging sessions, cost, and charging behavior.

### List View

Each charging session should show:

- Start and end time.
- Location/geofence.
- Energy delivered.
- Range added.
- Start/end SoC if available.
- Peak and average charging power.
- Duration.
- Cost and currency.
- Source confidence.

Filters:

- Date range.
- Vehicle.
- Location/geofence.
- Charging status.

### Detail View

Each session should show:

- Power-over-time chart.
- Energy-over-time chart.
- SoC/range-over-time chart if available.
- Price/cost data if available.
- Start/end snapshots.
- Data gaps.

### Cost Tracking

MVP should store Rivian-reported cost when available.

Later:

- Geofence-level price per kWh.
- Flat session fees.
- Time-of-use rates.
- Manual cost edits.

## Battery

### Purpose

Show long-term battery/range trends without overstating precision.

### Required Content

- SoC and estimated range over time.
- Estimated full-range trend when enough data exists.
- Battery capacity values if the API reports them.
- Charge limit history.
- Temperature overlays where useful.
- Notes when estimates are inferred or low-confidence.

### Guardrails

- Do not present degradation as definitive unless derived from stable, comparable data.
- Label inferred values clearly.
- Prefer trend lines over scary single-point conclusions.

## Locations

### Purpose

Make trip history inspectable by place.

### Required Content

- Lifetime map of visited locations.
- Geofence list.
- Create/edit/delete geofence.
- Reverse-geocoded address cache.
- Drives and charges by geofence.

### Location Retention

Exact location data is stored indefinitely by default.

Later privacy features may include:

- Export redaction.
- Home location blur on shared screenshots.
- Per-geofence privacy labels.

## Health

### Purpose

Expose vehicle health and software signals.

### Required Content

- Tire pressure history.
- 12V battery health if available.
- Brake fluid low flag.
- Battery thermal status.
- Service mode.
- Gear Guard/alarm status if available.
- OTA current version and available version.
- OTA install progress/history.

## Data Quality

### Purpose

Make collector reliability visible and debuggable.

### Required Content

- Collector status per vehicle.
- WebSocket subscription state.
- Last received vehicle-state event.
- Last successful charging-session fetch.
- Current backoff interval.
- Rate-limit events.
- Authentication failures.
- Reconnect history.
- Data gaps by day.
- Raw event ingestion count.
- Parser errors.

### Actions

- Restart collector.
- Re-authenticate Rivian account.
- Replay raw events for a date range.
- Export diagnostics with sensitive values redacted.

## Settings

### Required Content

- Local admin password change.
- Rivian account re-authentication.
- Enabled vehicles.
- Units: miles/km, Fahrenheit/Celsius, currency display.
- Collector intervals and conservative defaults.
- Database retention summary.
- Backup/export links.

### Explicit Exclusions

- No vehicle lock/unlock.
- No climate start/stop.
- No charge limit control.
- No remote start/stop charging.
- No phone key pairing.

## Home Assistant Integration Later

Not part of MVP, but design should leave room for:

- MQTT publishing of current state.
- Webhooks for drive/charge start/end.
- Read-only REST endpoint for current vehicle state.
- Home Assistant discovery payloads if MQTT is added.

No remote-control bridge should be included.

## Data Collection Requirements

### Vehicle State

Use a GraphQL WebSocket subscription for vehicle state when available.

Store:

- Raw event.
- Parsed snapshot.
- Position sample when location exists.
- Health sample when health fields change.
- State interval updates when power state changes.

### Charging Session

Fetch live charging session on an adaptive interval:

- Slow when unplugged.
- Fast when plugged in or charging.
- Back off on errors and rate limits.

Store:

- Raw response.
- Charging sample.
- Charging session aggregate.

### User/Vehicle Discovery

Fetch at startup and periodically:

- User account metadata needed for discovery.
- Vehicles.
- Vehicle capabilities.
- Wallboxes if available.

## Data Policy

Store indefinitely:

- Raw events.
- Parsed snapshots.
- Positions.
- Drives.
- Charging sessions.
- Health samples.
- Software history.

Allow manual deletion later, but do not build automatic retention deletion into MVP.

## MVP Acceptance Criteria

RivianMate MVP is usable when:

- A user can start it with Docker Compose.
- A user can create local admin credentials.
- A user can authenticate to Rivian with MFA.
- The app discovers at least one vehicle.
- The collector stores raw vehicle-state events.
- The collector stores parsed snapshots.
- The collector stores charging samples and sessions.
- The app derives basic drives from position/movement data.
- Overview shows current or last-known vehicle state.
- Drives page shows trip list and route details.
- Charging page shows session list and session details.
- Data Quality shows collector status and errors.
- Tokens are encrypted at rest.
- Logs redact tokens, VINs, precise coordinates, and account identifiers by default.

## Future Acceptance Criteria

Daily-driver maturity is reached when:

- Geofences are editable and applied to drives/charges.
- Charge costs can be manually corrected or configured by geofence.
- Battery trends are useful and clearly labeled.
- Software update history is visible.
- CSV/JSON export works.
- Backup and restore are documented.
- Home Assistant read-only integration exists.
