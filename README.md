<h1>
  <img src="web/public/icon.svg" alt="RivianMate" width="40" height="40" align="absmiddle">
  RivianMate
</h1>

[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)
[![Build status](https://img.shields.io/github/actions/workflow/status/blike/rivianmate/docker-publish.yml?branch=main&label=build)](https://github.com/blike/rivianmate/actions/workflows/docker-publish.yml)
[![Latest version](https://img.shields.io/github/v/release/blike/rivianmate?sort=semver&label=version&color=brightgreen)](https://github.com/blike/rivianmate/releases/latest)
[![Docker image size](https://img.shields.io/docker/image-size/mitchvitale/rivianmate/latest?label=image%20size)](https://hub.docker.com/r/mitchvitale/rivianmate)
[![Docker pulls](https://img.shields.io/docker/pulls/mitchvitale/rivianmate)](https://hub.docker.com/r/mitchvitale/rivianmate)

**A self-hosted data logger and dashboard for your Rivian.**

Drives, charging, battery health, and live vehicle state, recorded in your own database and shown on
a dashboard you can open from anywhere.

[Features](#features) · [Screenshots](#screenshots) · [Quick start](#quick-start) ·
[Configuration](#configuration) · [Contributing](#contributing)

## Why RivianMate

- **Self-hosted and private.** Run RivianMate on your own infrastructure using Docker Compose. Your
  vehicle data stays on your server, with no third-party cloud services or telemetry.
- **Read-only integration.** RivianMate monitors vehicle data without sending commands to your
  Rivian. API usage is designed to minimize unnecessary requests and avoid interfering with the
  official Rivian app.
- **R1 and R2 support.** Compatible with Rivian R1T, R1S, and R2 vehicles.

## Features

### Real-Time Vehicle Monitoring

- Live dashboard displaying battery level, estimated range, charge limits, vehicle closures, tire
  pressures, climate, and software information.
- Interactive vehicle map with live location tracking and active navigation details, including
  estimated arrival time and battery level at destination.
- Real-time updates pushed directly to the browser as new vehicle data becomes available.

### Drive Tracking & Analytics

- Automatic trip detection and logging.
- Interactive route maps with speed and elevation profiles.
- Detailed trip statistics, including distance, duration, efficiency, and energy consumption.
- Start and destination address identification.
- The weather on each drive (temperature, conditions, wind), looked up every 10 minutes along the
  route once it ends, and efficiency charted by temperature, speed, climb, length and weather.

### Charging History & Analytics

- Automatic charging session tracking with detailed power curves, energy delivered, range added,
  peak charging power, and estimated costs.
- Historical charging sessions imported from your Rivian account.
- Configurable electricity rates for home charging cost calculations.

### Battery & Vehicle Health

- Long-term battery capacity monitoring.
- Parked energy consumption tracking.
- Individual tire pressure trends to help identify gradual pressure loss.
- Software update history with a timeline of installed vehicle versions.

### Historical Data & Statistics

- Interactive charts for distance traveled, energy consumption, efficiency, and charging costs.
- Historical views ranging from 24 hours to 90 days.
- Battery level charts annotated with driving and charging events.

### Notifications

- Configurable alerts for open doors or windows, unlocked vehicles, completed charging sessions, low
  battery levels, tire pressure, and software updates.
- Notification delivery through Discord or Apprise.

### Mobile-Friendly Interface

- Responsive web interface optimized for desktop, tablet, and mobile devices.
- Full access to dashboards, trip history, charging sessions, and analytics from any screen size.

## Screenshots

<p>
  <img src="docs/screenshots/dashboard-desktop.png" alt="The dashboard on a desktop, partway through a drive home" width="73%">
  <img src="docs/screenshots/dashboard-mobile.png" alt="The dashboard on a phone, on the same drive home" width="23%">
</p>

Shown in demo mode with a simulated R1S. Map data © OpenStreetMap contributors and OpenMapTiles.

## Quick Start

RivianMate runs with Docker Compose and includes everything needed to get started, including a
PostgreSQL database.

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with Docker Compose
- A machine capable of running Docker, such as a home server, NAS, or VPS
- A Rivian account with a supported vehicle (R1T, R1S, or R2)

### Installation

**1. Download the configuration files**

```
mkdir rivianmate && cd rivianmate

curl -LO https://raw.githubusercontent.com/blike/rivianmate/main/docker-compose.yml
curl -Lo .env https://raw.githubusercontent.com/blike/rivianmate/main/.env.example
```

**2. Configure environment variables**

Generate a secure application secret:

```
openssl rand -hex 32
```

Edit `.env` and set the following values:

```
APP_SECRET=your-generated-secret
POSTGRES_PASSWORD=your-secure-database-password
```

Keep your `APP_SECRET` safe. It is used to encrypt stored Rivian authentication tokens and must
remain unchanged across restarts and updates.

**3. Start RivianMate**

```
docker compose up -d
```

**4. Complete initial setup**

Open `http://localhost:4000` or `http://<your-server-ip>:4000` in your browser.

Follow the setup wizard to create an application password, sign in to your Rivian account, and enter
the verification code provided by Rivian.

Once connected, RivianMate will begin collecting vehicle data automatically.

Rivian authentication tokens are stored encrypted, allowing data collection to resume after restarts
without requiring you to sign in again.

> **Remote access:** For access outside your local network, use a reverse proxy with HTTPS (such as
> Caddy, Traefik, or nginx) or a private network like [Tailscale](https://tailscale.com/). Do not
> expose port 4000 directly to the public internet.

## Configuration

RivianMate is configured using environment variables defined in the `.env` file. Docker Compose
automatically loads these values when starting the application.

| Variable            | Required    | Description                                                                                                                                                        |
| ------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `APP_SECRET`        | Yes         | Secret used to encrypt Rivian tokens and sign sessions. Generate with `openssl rand -hex 32`. Must remain consistent across restarts and updates.                  |
| `POSTGRES_PASSWORD` | Recommended | Password for the bundled PostgreSQL database. Defaults to `rivianmate`.                                                                                            |
| `APP_PORT`          | No          | Port used to access the web interface. Defaults to `4000`.                                                                                                         |
| `APP_PASSWORD`      | No          | Preconfigures the application password on first startup, bypassing the password setup screen. Must be at least 12 characters and not a common password or pattern. |
| `DATABASE_URL`      | No          | PostgreSQL connection string. Configured automatically by Docker Compose; override when using an external database.                                                |
| `LOG_LEVEL`         | No          | How much to log: `error`, `warn`, `info` (default) or `debug`. `debug` adds every HTTP request and routine live-stream renewals.                                   |
| `LOG_FORMAT`        | No          | `pretty` (default) for readable `docker logs` output, or `json` for one object per line to feed a log collector.                                                   |
| `TZ`                | No          | Time zone for times mentioned in log messages, such as `America/Los_Angeles`. Defaults to `UTC`. Dates in the app always follow your browser.                      |

Additional preferences are configured directly in the web interface under **Settings**, including:

- Units and currency
- Saved locations and electricity rates
- Vehicle management
- Notification preferences

Logs go to the container's output (`docker compose logs rivianmate`; add `-t` for timestamps). They
never include tokens, passwords, your email or vehicle locations.

When reporting a bug, set `LOG_LEVEL=debug`, reproduce the problem, and attach the output of
`docker compose logs rivianmate` (or the file from **Settings → Logs → Download**).

### Notifications

RivianMate supports configurable vehicle alerts through:

- **[Discord](https://discord.com/)** — Send notifications directly to a Discord channel using
  webhooks.
- **[Apprise API](https://github.com/caronc/apprise-api)** — Integrate with Pushover, ntfy,
  Telegram, Slack, email, and
  [many other notification services](https://github.com/caronc/apprise/wiki).

Configure notification providers and alert preferences under **Settings → Notifications**.

## Updating

To update RivianMate to the latest version, run the following commands from your installation
directory:

```
docker compose pull
docker compose up -d
```

Database migrations are applied automatically when the application starts.

Before updating, back up your PostgreSQL database and retain your existing `.env` file, especially
`APP_SECRET`. Changing this secret will invalidate encrypted Rivian tokens and require
reauthentication.

See the [Changelog](CHANGELOG.md) for release notes and changes.

### Docker Images

Prebuilt images are available on [Docker Hub](https://hub.docker.com/r/mitchvitale/rivianmate) under
`mitchvitale/rivianmate`.

| Tag         | Description                                                        |
| ----------- | ------------------------------------------------------------------ |
| `latest`    | Latest stable release (default)                                    |
| `0` / `0.6` | Latest release within the specified major or minor version         |
| `0.6.0`     | Specific release version                                           |
| `edge`      | Latest development build from `main`, including unreleased changes |

For most installations, the `latest` tag is recommended. Use a version-specific tag if you prefer to
control when upgrades occur.

## Privacy & Security

RivianMate is designed to keep your vehicle data under your control.

- **Local data storage.** Vehicle data and history are stored in your own PostgreSQL database.
- **Encrypted authentication.** Your Rivian password is used during authentication and is never
  stored. Authentication tokens are encrypted using AES-256-GCM with your `APP_SECRET`.
- **Application authentication.** Access to the web interface is protected by a password hashed
  using scrypt.
- **Read-only vehicle access.** RivianMate retrieves vehicle data without sending commands to the
  vehicle.
- **Isolated database.** The bundled PostgreSQL database is accessible only within the Docker
  network and is not exposed publicly.
- **No application telemetry.** RivianMate does not send your vehicle data to a RivianMate-operated
  analytics or cloud service.

The application makes external requests for vehicle data and authentication, map tiles through
[OpenFreeMap](https://openfreemap.org/), address lookups through OpenStreetMap's
[Nominatim](https://nominatim.org/), and outside temperatures through
[Open-Meteo](https://open-meteo.com/). Address and temperature lookups send the coordinates (and,
for temperatures, the times) of points along your drives to those services.

For more information, including how to responsibly disclose security vulnerabilities, see the
[Security Policy](SECURITY.md).

## Development

RivianMate is built with TypeScript across the frontend and backend.

**Technology Stack**

- **Frontend:** React, Vite, Tailwind CSS, MapLibre
- **Backend:** Node.js, Fastify
- **Database:** PostgreSQL, Drizzle ORM
- **Deployment:** Docker, Docker Compose

### Local Development

To run RivianMate locally, you'll need Node.js 22+, pnpm 10+, and Docker.

**1. Clone the repository**

```
git clone https://github.com/blike/rivianmate.git
cd rivianmate
```

**2. Start PostgreSQL**

```
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres
```

**3. Install dependencies and configure the environment**

```
pnpm install
cp .env.example .env
```

Edit `.env` to configure `APP_SECRET`, enable `DATABASE_URL`, and optionally enable `MOCK_RIVIAN`
for development without a vehicle.

**4. Start the development servers**

```
pnpm dev
```

In a separate terminal:

```
pnpm dev:web
```

The development servers are available at:

| Service       | URL                                             |
| ------------- | ----------------------------------------------- |
| API           | [http://localhost:4000](http://localhost:4000/) |
| Web interface | [http://localhost:5173](http://localhost:5173/) |

### Mock Vehicle Mode

RivianMate includes a simulated vehicle for development and testing without a Rivian account.

Enable the following in `.env`:

```
MOCK_RIVIAN=1
```

With mock mode enabled:

- Sign in using any email and password.
- Enter `000000` when prompted for a verification code.
- A simulated R1S generates driving, parking, and charging activity.
- Vehicle dashboards, charts, and historical data populate automatically.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines, testing, database migrations, and
code conventions.

## Contributing

Contributions are welcome! Whether you're reporting a bug, suggesting a feature, improving
documentation, or submitting code, your help is appreciated.

- **Bug reports and feature requests:** Open a
  [GitHub issue](https://github.com/blike/rivianmate/issues).
- **Code contributions:** Fork the repository and submit a pull request.
- **Larger changes:** Please open an issue to discuss your proposal before beginning significant
  work.

Before submitting a pull request, review the [Contributing Guidelines](CONTRIBUTING.md).

### AI-Assisted Contributions

RivianMate is developed with assistance from AI coding tools. All contributions, whether AI-assisted
or manually written, are held to the same standards for code quality, correctness, and
maintainability.

Contributors are expected to understand, test, and take responsibility for the code they submit.
AI-generated changes should be reviewed and validated before submission.

Project maintainers review contributions and remain responsible for changes merged into the project.

For information about the release process, see [RELEASING.md](RELEASING.md).

## Data Sources

RivianMate uses these free services and open datasets. The same credits appear in the app under
**Settings → About**.

- **Map data and addresses:** © [OpenStreetMap](https://www.openstreetmap.org/copyright)
  contributors, available under the Open Database License (ODbL).
- **Map tiles:** [OpenFreeMap](https://openfreemap.org/), built with
  [OpenMapTiles](https://openmaptiles.org/).
- **Address lookups:** [Nominatim](https://nominatim.org/).
- **Outside temperature:** weather model data by [Open-Meteo.com](https://open-meteo.com/), licensed
  under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). RivianMate interpolates it along
  each drive's route and averages it over the drive.

## License

Copyright © 2026 Mitch Vitale and contributors.

RivianMate is free and open-source software licensed under the **GNU General Public License v3.0
(GPL-3.0)**.

You are free to use, modify, and redistribute the software under the terms of this license. See
[LICENSE](LICENSE) for the complete license text.

The software is provided without warranty.

## Disclaimer

RivianMate is an independent, community-developed project and is not affiliated with, sponsored by,
or endorsed by Rivian Automotive, Inc. or any other vehicle manufacturer, software project, or
third-party service.

RivianMate relies on unofficial Rivian APIs that may change or become unavailable without notice.
Functionality and compatibility are not guaranteed.

Use at your own risk.
