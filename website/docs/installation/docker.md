---
title: Docker Compose
sidebar_label: Docker Compose
description: Install RivianMate and its database with Docker Compose.
---

# Install with Docker Compose

RivianMate ships as one Docker image, and a Compose file that runs it with its own PostgreSQL
database.

## Requirements

- [Docker](https://docs.docker.com/get-docker/) with Docker Compose
- A machine that stays on, such as a home server, NAS, Raspberry Pi 4/5 or a small VPS. Images are
  built for `linux/amd64` and `linux/arm64`.
- A Rivian account with an R1T, R1S or R2

## 1. Download the configuration

```bash
mkdir rivianmate && cd rivianmate

curl -LO https://raw.githubusercontent.com/blike/rivianmate/main/docker-compose.yml
curl -Lo .env https://raw.githubusercontent.com/blike/rivianmate/main/.env.example
```

The Compose file looks like this:

```yaml title="docker-compose.yml"
services:
  rivianmate:
    image: mitchvitale/rivianmate:latest
    restart: always
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgres://rivianmate:${POSTGRES_PASSWORD:-rivianmate}@postgres:5432/rivianmate
      APP_SECRET: ${APP_SECRET:?Set APP_SECRET to at least 32 random characters}
      LOG_LEVEL: ${LOG_LEVEL:-info}
      LOG_FORMAT: ${LOG_FORMAT:-pretty}
      TZ: ${TZ:-UTC}
    ports:
      - '${APP_PORT:-4000}:4000'

  postgres:
    image: postgres:18-alpine
    restart: always
    environment:
      POSTGRES_DB: rivianmate
      POSTGRES_USER: rivianmate
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-rivianmate}
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U rivianmate -d rivianmate']
      interval: 5s
      timeout: 5s
      retries: 20
    volumes:
      - postgres_data:/var/lib/postgresql

volumes:
  postgres_data:
```

## 2. Set the secrets

Generate an application secret:

```bash
openssl rand -hex 32
```

Then edit `.env`:

```ini title=".env"
APP_SECRET=paste-the-generated-secret
POSTGRES_PASSWORD=choose-a-database-password
```

:::warning Keep `APP_SECRET`

`APP_SECRET` encrypts your stored Rivian tokens and signs sessions. Keep it with your backups. If it
changes, RivianMate can't read the stored tokens and you'll have to sign in to Rivian again.

:::

See [Environment variables](../configuration/environment-variables.md) for everything else you can
set.

## 3. Start it

```bash
docker compose up -d
```

Database migrations run automatically on startup. Check that it came up:

```bash
docker compose ps
docker compose logs -f rivianmate
```

## 4. Finish setup in the browser

Open `http://localhost:4000`, or `http://<server-ip>:4000` from another machine. The setup wizard:

1. Creates the RivianMate password (at least 12 characters),
2. Signs in to your Rivian account and asks for the verification code Rivian sends.
3. Asks which outside lookups to allow (addresses and weather; see
   [Privacy & security](../privacy-security.md)),

Data collection starts as soon as Rivian is connected. Tokens are stored encrypted, so it carries on
after restarts without signing in again.

:::tip Remote access

Don't publish port 4000 to the internet. To open RivianMate away from home, use a
[reverse proxy with HTTPS or a private network like Tailscale](./reverse-proxy.md).

:::

## Image tags

| Tag          | What it is                                                 |
| ------------ | ---------------------------------------------------------- |
| `latest`     | The newest stable release (the default)                    |
| `0` / `0.12` | The newest release within that major or minor version      |
| `0.12.0`     | One exact release                                          |
| `edge`       | The newest build from `main`, including unreleased changes |

Pin a version tag if you want to decide when upgrades happen. Tags are listed on
[Docker Hub](https://hub.docker.com/r/mitchvitale/rivianmate/tags).
