# RivianMate

A self-hosted Rivian tracking app: a live vehicle dashboard plus long-term
history (battery, range, odometer, location trail, drives) and charging-session
logging, stored in Postgres.

It talks to the same unofficial Rivian cloud GraphQL API used by the
[home-assistant-rivian](https://github.com/bretterer/home-assistant-rivian)
integration (login + OTP, WebSocket vehicle-state subscription, charging and
wallbox queries) — ported to TypeScript. No Home Assistant required.

**Stack:** React 19 + Vite + Tailwind (frontend) · Node 22 + Fastify + Drizzle
ORM (backend) · Postgres · pnpm monorepo, TypeScript end to end.

## Features

- **Live dashboard** — battery, range, odometer, power/gear state, doors,
  closures, windows, climate, tires, software (OTA), and the vehicle on a map,
  streamed to the browser over SSE from Rivian's WebSocket subscription.
- **History** — state snapshots persist on change (plus 15-minute anchors);
  charts for battery/range/odometer/cabin temperature and a location trail.
- **Drives** — automatic drive detection (gear/power/speed heuristics with a
  3-minute park grace period), with distance, battery used, and route replay.
- **Charging** — live session card while plugged in (30-second polling,
  15 minutes when idle), a session log (energy, SOC, range added, peak power,
  editable cost), and wallbox status/readings.
- **Security** — single app password (scrypt); Rivian tokens are stored
  AES-256-GCM-encrypted with `APP_SECRET`. Your Rivian credentials are only
  forwarded to Rivian during login and never stored.

No vehicle commands (lock/unlock/climate) — this app is read-only and does not
enroll as a phone key.

## Remote deployment (Docker Compose)

```sh
cp .env.example .env         # set APP_SECRET (openssl rand -hex 32) and POSTGRES_PASSWORD
docker compose up -d
```

Open `http://<host>:4000`, set the app password, then sign in with your Rivian
account (email, password, and the emailed OTP code). Tokens are encrypted and
persisted, so the tracker resumes automatically after restarts.

Images are published to Docker Hub as `mitchvitale/rivianmate:latest` by the
GitHub Actions workflow on every push to `main`
([.github/workflows/docker-publish.yml](.github/workflows/docker-publish.yml)).
To update a deployment: `docker compose pull && docker compose up -d`.

## Local development

Requirements: Node 22+, pnpm 10 (`corepack enable`), Docker.

```sh
# 1. Postgres (published on localhost:5433 to avoid clashing with a host install)
docker compose -f docker-compose.yml -f docker-compose.override.example.yml up -d postgres

# 2. Install
pnpm install

# 3. API server (http://localhost:4000)
# Set APP_SECRET, DATABASE_URL, and optionally MOCK_RIVIAN in .env
pnpm dev

# 4. Web app with hot reload (http://localhost:5173, proxies /api to :4000)
pnpm dev:web
```

Set `MOCK_RIVIAN=1` to develop without a real Rivian account: any email and
password are accepted, the OTP code is `000000`, and a simulated R1T loops
through park → drive → park → charge so the dashboard, history, drives, and
charging pages all populate within a few minutes. Omit it to hit the real
Rivian API.

Useful commands: `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` ·
`pnpm --filter @rivianmate/server db:generate` (regenerate Drizzle migrations
after editing [server/src/db/schema.ts](server/src/db/schema.ts)).
Migrations run automatically at server boot.

If the API server must run on a different port, point the web proxy at it:
`VITE_API_TARGET=http://localhost:4100 pnpm dev:web`.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `APP_SECRET` | yes | ≥32 chars; encrypts Rivian tokens, signs sessions |
| `DATABASE_URL` | yes (compose sets it) | Postgres connection string |
| `PORT` / `APP_PORT` | no | API port (default 4000) / published host port |
| `MOCK_RIVIAN` | no | `1` = simulated vehicle, OTP `000000` |
| `APP_PASSWORD` | no | Seed the app password on first boot instead of the setup wizard |

> **Note:** rotating `APP_SECRET` invalidates stored Rivian tokens (they can no
> longer be decrypted); you'll be asked to reconnect your Rivian account.

## Repository layout

```
server   Fastify API, Rivian API client (HTTP + WebSocket), Drizzle schema,
         monitors (vehicle state, drives, charging), SSE fanout
web      React SPA (dashboard, history, drives, charging, settings)
home-assistant-rivian/   Upstream HACS integration, kept for reference only
```

## Disclaimer

Unofficial software; not affiliated with or endorsed by Rivian. It uses the
same private API as the Rivian mobile app — use at your own risk.
