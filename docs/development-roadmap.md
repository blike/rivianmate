# RivianMate Development Roadmap

## Step-by-Step Build Plan

### 1. Product Direction - Done

- Defined RivianMate as a local, single-user, Docker Compose app.
- Chose React frontend, TypeScript backend, and PostgreSQL.
- Confirmed no Grafana, no remote controls, and no automatic location deletion.
- Wrote product and technical planning docs.

### 2. Monorepo Foundation - Done

- Created a pnpm TypeScript workspace.
- Added app/package boundaries:
  - `apps/web`
  - `apps/api`
  - `apps/collector`
  - `packages/db`
  - `packages/rivian-api`
  - `packages/shared`
- Added root build and typecheck scripts.

### 3. Deployment Foundation - Done

- Added Dockerfile.
- Added Docker Compose with `app`, `collector`, and `postgres` services.
- Added `.dockerignore`.
- Verified `docker compose up -d --build` runs successfully.

### 4. Database Foundation - Done

- Added initial Postgres schema for vehicles, raw events, snapshots, positions, drives, charging sessions, and data-quality events.
- Added startup migration for a fresh database.
- Verified the schema is created in Docker Postgres.

### 5. API And Dashboard Skeleton - Done

- Added Fastify API.
- Added health, overview, vehicles, drives, charging, and data-quality endpoints.
- Added Vite React dashboard shell.
- Verified the production React build is served from the API container.

### 6. First-Run Local Admin Setup - Done

- Add local admin table.
- Add setup status endpoint.
- Add create-admin endpoint with password hashing.
- Add first-run setup UI.
- Verify the setup flow through Docker.

### 7. Local Login And Session Auth - Done

- Add login endpoint.
- Add session cookie storage.
- Protect app API routes after setup.
- Add logout flow.

Remaining polish for local auth:

- Add password-change flow in Settings.
- Add session pruning for expired sessions.

### 8. Rivian Credential Setup - Done

- Add Rivian credential form.
- Add MFA flow.
- Encrypt and store Rivian tokens using `APP_SECRET`.
- Surface authentication failures and re-auth states in the UI.

Completed so far:

- Added encrypted token storage helpers.
- Added Rivian credential status endpoint.
- Added Rivian username/password login endpoint.
- Added Rivian MFA challenge endpoint.
- Added dashboard credential form and OTP state.
- Added initial TypeScript Rivian GraphQL login/MFA client.
- Added read-only Rivian vehicle discovery query.
- Added vehicle discovery endpoint and manual dashboard action.
- Added automatic vehicle discovery after successful Rivian auth.
- Validated against a real Rivian account.
- Confirmed a discovered vehicle appears on the dashboard.

### 9. Rivian API Client Implementation - In Progress

- Implement CSRF/session creation. Done.
- Implement username/password authentication. Done.
- Implement OTP completion. Done.
- Implement vehicle discovery. Done.
- Implement live vehicle-state subscription. Done.
- Implement live charging-session fetch. Implemented, but Rivian currently returns the field as removed.

### 10. Collector Runtime - In Progress

- Load encrypted credentials. Done.
- Discover enabled vehicles. Done.
- Write collector heartbeat data-quality events. Done.
- Surface collector heartbeat health in the API. Done.
- Subscribe to vehicle state. Done.
- Store raw vehicle-state events. Done.
- Parse vehicle snapshots from subscription events. Done.
- Store position samples when location is present. Done.
- Surface latest parsed snapshot in Overview. Done.
- Poll charging data adaptively. Done for the live charging endpoint, with unsupported-field backoff.
- Derive charging intervals from vehicle-state charging signals. Done.
- Track collector health and data-quality events.

### 11. Sessionization

- Derive vehicle state intervals.
- Derive drives from movement/location samples. Done for basic movement sessions.
- Derive charging sessions from charger state and live charging data.
- Make derivation replayable from raw events.

### 12. Dashboard Depth

- Build full pages for Drives, Charging, Battery, Locations, Health, Data Quality, and Settings.
- Add map rendering. Done for current location.
- Add charts for speed, battery, charging power, and range. Done for battery/range snapshot history.

### 13. Export, Backup, And Repair Tools

- Add CSV/JSON export.
- Add diagnostics export with redaction.
- Add raw-event replay tools.
- Document backup and restore.

### 14. Optional Home Assistant Integration

- Add read-only API, MQTT publishing, or webhooks.
- Keep remote controls out of scope.
