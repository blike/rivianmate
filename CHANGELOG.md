# Changelog

## v0.8.0 — 2026-10-18

RivianMate `v0.8.0` adds a **vehicle state history** and a **trip-frequency map** to the History
page, a **live log view** in Settings, and **structured logging**. It also moves history to a **new
storage format** that records each change rather than whole snapshots.

> [!IMPORTANT]
>
> **Back up your database before updating.** This release converts your existing history to a new
> format and then deletes the old tables. The conversion can't be undone, so the only way back to
> v0.7.0 is restoring a backup taken beforehand. With the bundled `docker-compose.yml`:
>
> ```sh
> docker compose exec -T postgres pg_dump -U rivianmate -Fc rivianmate > rivianmate-v0.7.0.dump
> ```
>
> Keep your existing `APP_SECRET` too: stored Rivian tokens can't be read without it. See
> [Migrations](#migrations) for details.

### New features

#### History

- A **Vehicle state** panel shows when the vehicle was driving, charging, updating, awake or asleep:
  one row per day for 7 and 30 days, or a single bar for 24 hours and 90 days. The legend totals the
  time in each state, and hovering or tapping a segment shows its start, end and length. #52
- The location map draws each drive as its own faint line, so roads you drive more often build up to
  full color. #52

#### Logs

- **Settings → Logs** shows the server's recent log lines live, with level and text filters and a
  download as a `.log` file. Lines are redacted the same way as the container output. #53
- Logging has levels and redaction: tokens, passwords, emails and coordinates never appear in the
  output. `LOG_LEVEL` (default `info`) sets how much is logged, and `LOG_FORMAT=json` gives one
  object per line for a log collector. At `info`, the log reads as a timeline of startup, stream
  connection, drives, charges and alerts. #51

### Improvements

- History is stored as each field's changes of value, with a heartbeat every 15 minutes while the
  vehicle is reporting, instead of a full snapshot of every field at every update. Parallax messages
  are archived compactly and rolled up by the hour. Existing history is converted in the background
  after upgrading. #54
- The charging curve marks the charge limit the session was charging toward. #52
- Drives that moved less than 100 m, such as shifting in and out of gear in place, are left out of
  the drive list, history totals and the dashboard. Nothing is deleted. #53
- Errors that were silently ignored are now logged, such as unreadable notification settings or
  stored tokens that can't be decrypted. #51
- The location history API simplifies each drive's track rather than keeping every nth point, so
  repeat trips line up on the map. #52

### Fixes

- Stopping the container no longer hangs for 10 seconds while a browser tab is open. Before, the
  open live-update stream kept the server from shutting down until Docker killed it, leaving any
  drive in progress open. #51
- The dashboard's last drive card wraps a long route onto a second line instead of cutting it off.
  #52

### Migrations

This release includes one database migration, which runs automatically on startup:

- `0017_history_stores`: adds the new history and Parallax archive tables, a short vehicle number
  for them, and columns for each vehicle's build details and renders

After the migration, existing state snapshots and the Parallax log are converted into the new tables
in the background, then the old tables are dropped. This can take a few minutes on a large database;
history fills in as it runs. The conversion is one-way: to roll back to v0.7.0, restore the database
backup as well as the image.

**Back up Postgres before updating** (see the command at the top of these notes), preserve your
existing `APP_SECRET` and database volume, then run `docker compose pull && docker compose up -d`.

### API

- New: `GET /api/vehicles/:id/state-spans` for the vehicle state panel. #52
- New: `GET /api/logs/stream`, an authenticated event stream of log lines. #53
- Location points include the `driveId` they were recorded on. #52
- Charging sessions include `socLimit`, the charge limit when the session ended (or now, while it's
  under way). #52

### Updates

- Vehicle discovery also fetches each vehicle's build date and factory configuration (trim, drive
  system, colors, wheels) and its renders, for upcoming views. #54
- `console` output is replaced by a logger with a child per component (`app`, `monitor`, `ws`,
  `drive`, `charging`, `notify`, …). #51

**Full Changelog**:
[https://github.com/blike/rivianmate/compare/v0.7.0...v0.8.0](https://github.com/blike/rivianmate/compare/v0.7.0...v0.8.0)

## v0.7.0 — 2026-10-17

RivianMate `v0.7.0` brings **improved R2 support**, **saved locations** with their own charging
rates, **navigation** on the dashboard, and improved drive and charge cards.

### New features

#### R2 support

- Drives, doors, windows, locks, cabin climate and live charging, read from Parallax. #39 #45
- The dashboard shows an R2's battery, range, charge limit, odometer and software version. #42 #43
- Schedules show the next charging window, and Health checks the 12V battery and pack. #42 #43 #45
- Pages show only what the vehicle reports. #43 #48

#### Saved locations

- **Settings → Locations** replaces Settings → Charging: any number of named places, each with its
  own charging rate (0 for free), a "Counts as home" switch, and an area set on a map. #40
- Drives and charges at a saved place take its name, such as "Home → Work". #40
- Sessions without a cost of their own are priced at their location's rate. #40
- "Only when not at home" alerts are held at every location marked as home. #40

#### Navigation

- The dashboard map draws the planned route as a dashed line, with a ring at the destination. #46
- While navigating, the drive card shows distance to go, arrival time and battery on arrival. #46
- The drive under way on the Drives page shows its planned route. #46

### Improvements

- The dashboard's drive and charge cards keep one layout in every state and while loading. Charging
  shows the battery toward its limit and when it will finish, and a plugged-in vehicle shows when
  its schedule starts. #47
- Live and past charges share one card on the Charging page. Energy and cost are estimated from the
  battery gained until Rivian reports them. #47
- Live drives and charges are tagged **In progress**, **Charging** or **Plugged in**. #46
- Software updates follow every stage Rivian reports, including waiting for a connection and
  preparing. #38
- Charging schedules refresh when the vehicle's next charging window changes, not only every 6
  hours. #45
- The charging curve runs to where charging stopped. #48
- The feed viewer names more fields, and a legacy feed that only ever sends nulls shows as "No
  data". #45 #46
- The currency setting moves to **General → Units**. #40

### Fixes

- GPS speed is read from the right field. #43
- "Only when not at home" alerts are no longer sent at home when the vehicle's GPS fix drops out.
  #38
- An installed update no longer shows as still installing at 99%. #38
- Charging status reads connecting and stopped correctly. #45
- Sessions from plugging in and out without charging are removed. #45
- The charging curve is no longer drawn as steps from leftover points. #48
- Navigation's arrival battery and range now show. #46
- The dashboard shows a shut charge port as "Closed" and the 12V battery as "Normal". #42 #48

### Migrations

This release includes one database migration, which runs automatically on startup:

- `0016_saved_locations`: adds saved locations, carrying over your home location and rate as
  **Home**

Back up Postgres before updating, preserve your existing `APP_SECRET` and database volume, then run
`docker compose pull && docker compose up -d`.

### API

`/api/settings/home-charging` is now `/api/settings/charging`, which holds only the currency.
Locations are managed under `/api/locations`. #40

### Updates

- Parallax decoding is split into a registry with one definition per topic. #41 #42
- The README is rewritten with new screenshots, taken with a new drive-home demo scene for mock
  mode. #49

### Thanks

@leetosc

**Full Changelog**:
[https://github.com/blike/rivianmate/compare/v0.6.0...v0.7.0](https://github.com/blike/rivianmate/compare/v0.6.0...v0.7.0)

## v0.6.0 — 2026-10-11

RivianMate `v0.6.0` is here with **redesigned pages**, **notifications**, saved **software release
notes**, and various fixes.

### New features

#### Redesigned pages

- **History**: a summary of driving, efficiency and charging cost, distance by day, and a chart that
  shades drives, charging and plugged-in time. Hovering the chart marks the spot on the map. #26
- **Drives and Charging**: header cards with key figures, lists grouped by day with daily totals,
  and a picker on narrow screens. #26 #27
- **Navigation**: a new menu on phones. #27
- **Schedules**: the next charging window first, and a week view of charging windows. #26
- **Health**: an overview of checks, battery capacity as the vehicle reports it with a trend line,
  and a tire diagram with slow-leak detection. #22 #26
- **Settings**: grouped rows, an Imperial / Metric choice, and an example cost for the home rate.
  #26

#### Notifications

- Get alerts for vehicle events in Discord, or through an
  [Apprise](https://github.com/caronc/apprise) server in Pushover, ntfy, Telegram, Slack, email and
  more. #23 #25
- Door or window left open, and vehicle left unlocked, after a set time while parked
- "Only when not at home" option for closure alerts
- Tire pressure, low battery and charging complete
- Software update available, installed and failed, with a link to the release notes
- Off by default; turn on and add destinations under **Settings → Notifications**

#### Software updates

- Release notes for each version are saved, so they stay available after an update installs. #24
- Live download and install progress on the dashboard and in Health. #24
- Health shows installed versions as a timeline, with any pending update at the end. #24 #26

#### API & Feeds

- Status for each Rivian feed: receiving, waiting, unsupported or errored. #22
- The latest data each feed received, down to the raw Parallax fields. #33

### Improvements

- Drive and charge battery levels show one decimal place. #31 #35
- Drives show range used or gained, Wh per mile (or km) and kWh used. #35
- A drive under way with no destination is titled "From Home" instead of "Home → …". #35
- The dashboard's last drive card shows the home icon when applicable and wraps long addresses. #35
- The Drives chart marks the hovered point on the route map, and its tooltip shows time into the
  drive and time of day. #24
- History's 7d, 30d and 90d ranges start at midnight, and every distance bar is labeled. #31
- Clearer brake fluid and preconditioning labels on the dashboard. #21

### Fixes

- GPS location, speed and tire pressure are restored on vehicles where Rivian's older feed stopped
  providing them. #14 #15
- Rivian charging sessions no longer show a falsely low cost. Rivian's billed total replaces the
  early estimate, and existing sessions are corrected on the next charge-history import. #26
- Drives end when the vehicle parks, without a trailing stretch of near-zero speed, and parking
  noise no longer starts a new drive. Drives already recorded are repaired. #29
- The dashboard no longer shows "Asleep" while the vehicle is awake or driving. #32
- Software release notes appear again. #24

### Migrations

This release includes three database migrations, which run automatically on startup:

- `0013_ota_release_notes_pdf`: stores release-notes PDFs
- `0014_session_cost_edited`: keeps charging costs entered by hand
- `0015_drive_ends_at_park`: repairs drives that ended late

Back up Postgres before updating, preserve your existing `APP_SECRET` and database volume, then run
`docker compose pull && docker compose up -d`.

### Configuration

`MAP_STYLE_URL`, `MAP_TILES_URL`, `MAP_GLYPHS_URL` and `REVERSE_GEOCODING` are no longer used and
can be removed from `.env`. Maps always use OpenFreeMap, and drive addresses are always looked up.

### Updates

- RivianMate is now licensed under GPL-3.0. #28
- Added contributing and security guides, issue templates and a rewritten README. #28
- Code formatting checked in CI with Prettier. #28

### Thanks

@edasque @s3rverro0m

**Full Changelog**:
[https://github.com/blike/rivianmate/compare/v0.5.0...v0.6.0](https://github.com/blike/rivianmate/compare/v0.5.0...v0.6.0)

## v0.5.0 — 2026-10-04

- Redesigned dashboard with a themed MapLibre GL map, active navigation (distance, arrival time, and
  battery on arrival), cell temperature, cold-weather range impact, and Wi-Fi and cellular status.
- Parked energy for the last 24 and 8 hours is shown as bars split into system, climate, Gear Guard,
  and outlets. Inflated parked-drain figures are fixed.
- Charging is tracked per plug-in and resumes across restarts. Live readings come from Rivian's
  Parallax data first, with a fallback to vehicle state when the push goes quiet, so charge power no
  longer flickers.
- Each completed charge shows a bar splitting the energy added into what was stored and what went to
  heating or cooling the pack. Charging curves are smoothed, filled in from Rivian's latest-session
  history, and keep Rivian's forecast separate (shown only while charging). Charges that will stop
  short of the limit say so.
- Set a home electricity rate to estimate the cost of home sessions.
- Charging schedules are shown as a week timeline. Departure schedules are fixed.
- Drives record start and end addresses (via OpenStreetMap, can be turned off with
  `REVERSE_GEOCODING=false`), navigation destinations, and live speed. Detection is more robust, and
  drives and GPS that Rivian delivers late are recorded. Route maps open framed on the route.
- History chart ticks line up with hours and days. Navigation collapses into a menu on mobile.
- New README with screenshots. RivianMate is now licensed under MIT.

### Upgrading

Back up Postgres before updating, preserve your existing `APP_SECRET` and database volume, then run
`docker compose pull && docker compose up -d`. Database migrations run automatically.

The bundled Postgres is no longer published on host port 5433 by `docker-compose.yml`. For local
development, add `-f docker-compose.dev.yml`, which publishes it on `localhost:5433`. The `HOST`,
`WEB_DIST`, and `POSTGRES_PORT` settings are no longer used and can be removed from `.env`.

## v0.4.0 — 2026-09-30

- Pages no longer flash "No vehicles found", empty charts, or other empty states while loading.
  Panels show placeholders at their final size, values render in your units from the start, and
  switching ranges keeps the previous chart until the next one loads.
- Live charging stats appear immediately after a page refresh.
- Redesigned sign-in and onboarding screens, including a six-digit verification code input that
  accepts paste and one-time-code autofill and submits automatically.
- Stronger app password requirements: new passwords need at least 12 characters and can't be common
  passwords, the app name, or patterns like 1234, with a live strength meter. Existing passwords
  keep working.
- Settings → About shows the running version and build commit.
- Updated all dependencies to their latest versions, with no known vulnerabilities.
- Faster multi-platform Docker builds.

### Upgrading

Back up Postgres before updating, preserve your existing `APP_SECRET` and database volume, then run
`docker compose pull && docker compose up -d`.

Docker image tags have changed. `latest` now means the newest stable release and is the default in
`docker-compose.yml`; pin a line with `0.4` or an exact release with `0.4.0`. Builds of every `main`
commit are now published as `edge` instead of `latest`.

If you set `APP_PASSWORD` and the app has no password yet, it must meet the new password
requirements or the server will refuse to start. It's ignored once a password exists.

## v0.3 — 2026-09-30

- Quieter, more resilient Rivian connections with shared request throttling, rate-limit backoff,
  authenticated streaming, and API usage diagnostics.
- Model-aware vehicle closures and a dashboard badge showing data freshness.
- App-wide distance, temperature, speed, and tire-pressure unit settings.
- Per-drive efficiency, energy estimates, elevation totals, and route profiles.
- Charging curves, imported Rivian charging history, and read-only charging and departure schedules.
- A Health page with parked battery drain, estimated battery capacity, tire-pressure trends, and a
  software-update timeline with release-note links.
- New app and home-screen icons, plus VIN display and copying in Settings.
- Corrected chart precision, mock drive completion, historical speed units, container healthchecks,
  and startup behavior when Rivian is unavailable.
- Restored session-based Rivian authentication when reusing stored credentials after an upgrade or
  restart. Failed monitor startup now reports disconnected and prompts for re-login when Rivian
  rejects the session.
- Automated validation and versioned Docker images for amd64 and arm64.

### Upgrading

Back up Postgres before updating. Database migrations run automatically and include a one-time
correction of previously stored speed values. Preserve your existing `APP_SECRET` and database
volume. Set `image: mitchvitale/rivianmate:0.3` in `docker-compose.yml`, then run
`docker compose pull && docker compose up -d`.

Health trends and charging curves need recorded data; imported charging summaries do not recreate
historical charging curves. Rivian may reject optional schedule, history, or release-note queries,
in which case that feature disables its requests for the current run.
