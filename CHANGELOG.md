# Changelog

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
