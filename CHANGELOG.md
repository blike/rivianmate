# Changelog

## v0.5.0 — 2026-10-04

- Redesigned dashboard with a themed MapLibre GL map, active navigation
  (distance, arrival time, and battery on arrival), cell temperature,
  cold-weather range impact, and Wi-Fi and cellular status.
- Parked energy for the last 24 and 8 hours is shown as bars split into
  system, climate, Gear Guard, and outlets. Inflated parked-drain figures are
  fixed.
- Charging is tracked per plug-in and resumes across restarts. Live readings
  come from Rivian's Parallax data first, with a fallback to vehicle state
  when the push goes quiet, so charge power no longer flickers.
- Each completed charge shows a bar splitting the energy added into what was
  stored and what went to heating or cooling the pack. Charging curves are
  smoothed, filled in from Rivian's latest-session history, and keep Rivian's
  forecast separate (shown only while charging). Charges that will stop short
  of the limit say so.
- Set a home electricity rate to estimate the cost of home sessions.
- Charging schedules are shown as a week timeline. Departure schedules are
  fixed.
- Drives record start and end addresses (via OpenStreetMap, can be turned
  off with `REVERSE_GEOCODING=false`), navigation destinations, and live
  speed. Detection is more robust, and drives and GPS that Rivian delivers
  late are recorded. Route maps open framed on the route.
- History chart ticks line up with hours and days. Navigation collapses into
  a menu on mobile.
- New README with screenshots. RivianMate is now licensed under MIT.

### Upgrading

Back up Postgres before updating, preserve your existing `APP_SECRET` and
database volume, then run `docker compose pull && docker compose up -d`.
Database migrations run automatically.

The bundled Postgres is no longer published on host port 5433 by
`docker-compose.yml`. For local development, add
`-f docker-compose.dev.yml`, which publishes it on `localhost:5433`. The
`HOST`, `WEB_DIST`, and `POSTGRES_PORT` settings are no longer used and can
be removed from `.env`.

## v0.4.0 — 2026-09-30

- Pages no longer flash "No vehicles found", empty charts, or other empty
  states while loading. Panels show placeholders at their final size, values
  render in your units from the start, and switching ranges keeps the previous
  chart until the next one loads.
- Live charging stats appear immediately after a page refresh.
- Redesigned sign-in and onboarding screens, including a six-digit
  verification code input that accepts paste and one-time-code autofill and
  submits automatically.
- Stronger app password requirements: new passwords need at least 12
  characters and can't be common passwords, the app name, or patterns like
  1234, with a live strength meter. Existing passwords keep working.
- Settings → About shows the running version and build commit.
- Updated all dependencies to their latest versions, with no known
  vulnerabilities.
- Faster multi-platform Docker builds.

### Upgrading

Back up Postgres before updating, preserve your existing `APP_SECRET` and
database volume, then run `docker compose pull && docker compose up -d`.

Docker image tags have changed. `latest` now means the newest stable release
and is the default in `docker-compose.yml`; pin a line with `0.4` or an exact
release with `0.4.0`. Builds of every `main` commit are now published as `edge`
instead of `latest`.

If you set `APP_PASSWORD` and the app has no password yet, it must meet the new
password requirements or the server will refuse to start. It's ignored once a
password exists.

## v0.3 — 2026-09-30

- Quieter, more resilient Rivian connections with shared request throttling,
  rate-limit backoff, authenticated streaming, and API usage diagnostics.
- Model-aware vehicle closures and a dashboard badge showing data freshness.
- App-wide distance, temperature, speed, and tire-pressure unit settings.
- Per-drive efficiency, energy estimates, elevation totals, and route profiles.
- Charging curves, imported Rivian charging history, and read-only charging
  and departure schedules.
- A Health page with parked battery drain, estimated battery capacity,
  tire-pressure trends, and a software-update timeline with release-note links.
- New app and home-screen icons, plus VIN display and copying in Settings.
- Corrected chart precision, mock drive completion, historical speed units,
  container healthchecks, and startup behavior when Rivian is unavailable.
- Restored session-based Rivian authentication when reusing stored credentials
  after an upgrade or restart. Failed monitor startup now reports disconnected
  and prompts for re-login when Rivian rejects the session.
- Automated validation and versioned Docker images for amd64 and arm64.

### Upgrading

Back up Postgres before updating. Database migrations run automatically and
include a one-time correction of previously stored speed values. Preserve your
existing `APP_SECRET` and database volume. Set
`image: mitchvitale/rivianmate:0.3` in `docker-compose.yml`,
then run `docker compose pull && docker compose up -d`.

Health trends and charging curves need recorded data; imported charging summaries
do not recreate historical charging curves. Rivian may reject optional schedule,
history, or release-note queries, in which case that feature disables its requests
for the current run.
