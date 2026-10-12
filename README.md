# <img src="web/public/icon.svg" alt="" width="40" height="40" align="absmiddle"> RivianMate

**A self-hosted data logger and dashboard for your Rivian.**

Drives, charging, battery health, and live vehicle state, recorded in your own database and shown on
a dashboard you can open from anywhere.

<p>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-blue" alt="License: GPL-3.0"></a>
  <a href="https://github.com/blike/rivianmate/releases/latest"><img src="https://img.shields.io/github/v/release/blike/rivianmate?sort=semver&label=version&color=brightgreen" alt="Latest version"></a>
  <a href="https://hub.docker.com/r/mitchvitale/rivianmate"><img src="https://img.shields.io/docker/image-size/mitchvitale/rivianmate/latest?label=image%20size" alt="Docker image size"></a>
  <a href="https://hub.docker.com/r/mitchvitale/rivianmate"><img src="https://img.shields.io/docker/pulls/mitchvitale/rivianmate" alt="Docker pulls"></a>
  <a href="https://github.com/blike/rivianmate/actions/workflows/docker-publish.yml"><img src="https://img.shields.io/github/actions/workflow/status/blike/rivianmate/docker-publish.yml?branch=main&label=build" alt="Build status"></a>
</p>

[Features](#features) · [Screenshots](#screenshots) · [Quick start](#quick-start) ·
[Configuration](#configuration) · [Contributing](#contributing)

## Why RivianMate

- **Your data, your server.** One Docker Compose file runs the app and its database. There's no
  cloud service, account or analytics behind it.
- **Read-only and gentle.** RivianMate never sends commands to the vehicle, and it keeps its Rivian
  traffic low so your phone app keeps working.
- **Built for Rivian.** Doors, gates, the gear tunnel and tonneau, Gear Guard, drive modes, the
  Rivian Adventure Network and the Rivian Wall Charger are all understood, not just battery and
  location.

## Features

- **Live dashboard.** Battery, range, charge limit, closures, tire pressures, climate, software, and
  active navigation with arrival time and battery on arrival. The vehicle follows the map as it
  drives, and updates are pushed to the browser as they arrive.
- **Drives.** Detected automatically, with the route on a map, a speed and elevation chart,
  efficiency, energy used, and start and end addresses.
- **Charging.** Every session with its power curve, energy, range added, peak power and cost. Past
  sessions are imported from your Rivian account, and home sessions are priced from your electricity
  rate.
- **Battery and vehicle health.** Battery capacity over time, energy used while parked, per-tire
  pressure trends that make slow leaks stand out, and a timeline of every software version the
  vehicle has run.
- **History.** Distance, efficiency, energy and cost from the last 24 hours to 90 days, with drives
  and charging marked on the battery chart.
- **Notifications.** Alerts for doors or windows left open, unlocked, charging complete, low
  battery, tire pressure and software updates, sent to Discord or Apprise.
- **Works on your phone.** Every page fits a phone screen.

## Screenshots

<p>
  <img src="docs/screenshots/dashboard-desktop.png" alt="The dashboard on a desktop, with the vehicle parked" width="73%">
  <img src="docs/screenshots/dashboard-mobile.png" alt="The dashboard on a phone, while charging" width="23%">
</p>

Shown in demo mode with a simulated R1S. Map data © OpenStreetMap contributors and OpenMapTiles.

## Quick start

You need a machine that's always on (a home server, NAS, or small VPS) with Docker and Docker
Compose.

1. **Get the compose file and environment template.**

```sh
 mkdir rivianmate && cd rivianmate
 curl -O https://raw.githubusercontent.com/blike/rivianmate/main/docker-compose.yml
 curl -o .env https://raw.githubusercontent.com/blike/rivianmate/main/.env.example
```

2. **Set your secrets** in `.env`:

```sh
 APP_SECRET=$(openssl rand -hex 32)       # paste the output into .env
 POSTGRES_PASSWORD=<a strong password>
```

3. **Start it.**

```sh
 docker compose up -d
```

4. **Open** `http://<your-server>:4000`**.** Create an app password, then sign in with your Rivian
   account and the verification code Rivian sends you. Your vehicles appear within a few seconds.

You only sign in to Rivian once: tokens are stored encrypted and tracking resumes after restarts.
For access away from home, put RivianMate behind a reverse proxy with HTTPS (Caddy, Traefik, nginx)
or a private network such as Tailscale. Don't expose port 4000 directly to the internet.

## Configuration

Everything is set through environment variables, which Docker Compose reads from `.env`.

| Variable            | Required    | Description                                                                                                                                                                                                     |
| ------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_SECRET`        | **yes**     | At least 32 random characters (`openssl rand -hex 32`). Encrypts stored Rivian tokens and signs sessions. Keep it unchanged: a new secret makes stored tokens unreadable and you'll have to reconnect to Rivian |
| `POSTGRES_PASSWORD` | recommended | Password for the bundled Postgres database (defaults to `rivianmate`)                                                                                                                                           |
| `APP_PORT`          | no          | Host port for the web app (default `4000`)                                                                                                                                                                      |
| `APP_PASSWORD`      | no          | Sets the app password on first start instead of using the setup screen. At least 12 characters, and not a common password or pattern                                                                            |
| `DATABASE_URL`      | no          | Postgres connection string. Compose sets it for the bundled database; set it only to use an external Postgres                                                                                                   |

Units, your home location and electricity rate, notifications, and vehicles are set in the app under
**Settings**.

### Notifications

RivianMate can send alerts to [Discord](https://discord.com) webhooks and to
[Apprise API](https://github.com/caronc/apprise-api) servers, which forward to Pushover, ntfy,
Telegram, Slack, email and [many more](https://github.com/caronc/apprise/wiki). Set them up in
**Settings → Notifications**.

### TeslaMate

Also have a Tesla logged by [TeslaMate](https://github.com/teslamate-org/teslamate)? Add its
database under **Settings → General → Accounts** and its cars join the vehicle menu, on the same
dashboard, drives, charging, history and health pages, with drives and charging sessions updating
live while they happen.

RivianMate only reads from TeslaMate: it opens a read-only session, copies nothing into its own
database, and never writes to TeslaMate's. Enter a Postgres URL such as
`postgres://teslamate:password@192.168.1.10:5432/teslamate`. The database has to be reachable from
the RivianMate container, for example by publishing TeslaMate's Postgres port or by putting both on
the same Docker network. The URL is stored encrypted with `APP_SECRET`.

TeslaMate doesn't log some things Rivian reports, such as locks, doors, the charge limit and pending
software updates, so those parts of the pages are left out for Tesla vehicles, and notifications
only cover Rivian vehicles.

## Updating

```sh
docker compose pull && docker compose up -d
```

Database migrations run automatically at startup. Back up Postgres before updating, and keep the
same `APP_SECRET`. See [CHANGELOG.md](CHANGELOG.md) for what changed.

Images are published to Docker Hub as
`[mitchvitale/rivianmate](https://hub.docker.com/r/mitchvitale/rivianmate)`:

| Tag         | Tracks                                               |
| ----------- | ---------------------------------------------------- |
| `latest`    | The newest stable release (the default)              |
| `0` / `0.5` | The newest release in that major or minor line       |
| `0.5.0`     | Exactly that release                                 |
| `edge`      | Every commit on `main`, including unreleased changes |

## Privacy and security

- Your Rivian password goes to Rivian once, at sign-in, and is never stored. The resulting tokens
  are encrypted (AES-256-GCM) with `APP_SECRET`.
- The web app is protected by an app password, hashed with scrypt.
- All data stays in your Postgres database, which isn't published outside the Docker network. The
  only other outbound requests are map tiles from [OpenFreeMap](https://openfreemap.org) and address
  lookups for drive start and end points from OpenStreetMap's [Nominatim](https://nominatim.org),
  plus read-only queries to your TeslaMate database if you add one.

Found a vulnerability? Please report it privately as described in [SECURITY.md](SECURITY.md).

## Development

RivianMate is TypeScript end to end: a Fastify server with Drizzle and Postgres, and a React, Vite
and Tailwind web app with MapLibre maps. You need Node 22+, pnpm 10 and Docker.

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres
pnpm install
cp .env.example .env        # set APP_SECRET, uncomment DATABASE_URL and MOCK_RIVIAN
pnpm dev                    # API server on http://localhost:4000
pnpm dev:web                # web app on http://localhost:5173
```

With `MOCK_RIVIAN=1` you don't need a Rivian account: any email and password work, the verification
code is `000000`, and a simulated R1S drives, parks and charges so every page fills in.

[CONTRIBUTING.md](CONTRIBUTING.md) covers the checks to run, database migrations and code style.
[RELEASING.md](RELEASING.md) covers releases.

## Contributing

Bug reports, fixes and features are welcome. For anything larger than a small fix, please open an
issue first so we can agree on the approach. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening
a pull request.

## Use of AI

RivianMate is written with the help of AI coding assistants. They speed up the work, but they don't
replace understanding it: every change is read, tested and understood by a maintainer before it's
merged, and the maintainer answers for it like any other code. Design decisions, and the rules the
project holds to, are made by people.

Contributions written with AI help are welcome on the same terms. You're responsible for what you
submit: understand it, test it, and be ready to explain it in review.

## License

Copyright © 2026 Mitch Vitale and contributors.

RivianMate is free software: you can redistribute it and modify it under the terms of the
[GNU General Public License, version 3](LICENSE). It comes with no warranty.

## Disclaimer

RivianMate is unofficial and is not affiliated with or endorsed by Rivian. It relies on a private
API that may change without notice. Use it at your own risk.
