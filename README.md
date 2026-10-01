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
- **Charging** — live session card pushed over the same WebSocket as vehicle
  state, a session log (energy, SOC, range added, peak power, editable cost),
  and wallbox status/readings.
- **Security** — single app password (scrypt); Rivian tokens are stored
  AES-256-GCM-encrypted with `APP_SECRET`. Your Rivian credentials are only
  forwarded to Rivian during login and never stored.

No vehicle commands (lock/unlock/climate) — this app is read-only and does not
enroll as a phone key.

## How RivianMate talks to Rivian

Your Rivian account is shared with the official phone app. If a third-party
client floods the Rivian cloud, or keeps retrying after it's told to back off,
the phone app can lose its connection to the vehicle. RivianMate keeps its
traffic low:

- **Push, not polling.** Vehicle state and live charging data come from one
  WebSocket with one subscription per vehicle and data type. Each
  subscription is sent once per connection and never re-sent on a quiet
  socket. Dead sockets are detected with WebSocket ping frames, which don't
  generate GraphQL traffic.
- **One session.** The CSRF/app session from login is reused by the REST
  client and the WebSocket handshake. It is rotated only when Rivian rejects
  it, and simultaneous rejections trigger a single rotation.
- **Polling only as a fallback.** When the socket has been down for more
  than 5 minutes, state is polled every 5 minutes while the vehicle is awake
  and every 30 minutes while it's asleep. While plugged in, charging is
  checked over REST every 5 minutes, and only if pushed charging data has
  stopped arriving. Wallboxes are refreshed at startup and every 15 minutes
  while charging.
- **Occasional extras.** Charging schedules are fetched at startup and every
  6 hours. Rivian's charging history is synced at startup, 15 minutes after a
  charge ends, and daily. Release notes are fetched once per software
  version. Departure schedules ride on the existing socket. Each of these
  turns itself off for the run if Rivian rejects it.
- **Backing off.** All requests go through one process-wide queue, spaced at
  least 2 seconds apart. A rate-limit response (HTTP 429 or `RATE_LIMIT`)
  pauses *all* traffic for at least 5 minutes, doubling up to 1 hour, or for
  as long as Rivian's `Retry-After` asks if that is longer. WebSocket
  reconnects back off from 10 seconds to 15 minutes with jitter. Rivian's
  scheduled connection-TTL close (4420) is renewed quickly and doesn't count
  as an error.
- **Tolerant auth.** A single credential rejection triggers a session
  rotation. You're asked to sign in again only after three rejections in a
  row.

**Settings → Rivian API usage** shows request counts per operation, socket
reconnects, session refreshes, and rate limits for the last 24 hours. Run
only **one** RivianMate instance per Rivian account. A dev server and a
production container on the same account double the traffic.

## Remote deployment (Docker Compose)

```sh
cp .env.example .env         # set APP_SECRET (openssl rand -hex 32) and POSTGRES_PASSWORD
docker compose up -d
```

Open `http://<host>:4000`, set the app password, then sign in with your Rivian
account (email, password, and the emailed OTP code). Tokens are encrypted and
persisted, so the tracker resumes automatically after restarts.

Images are published to Docker Hub as `mitchvitale/rivianmate:latest` by the
GitHub Actions workflow after validation on every push to `main` and release tag (`v*`)
([.github/workflows/docker-publish.yml](.github/workflows/docker-publish.yml)).
To update a deployment: `docker compose pull && docker compose up -d`.

For v0.3, set `RIVIANMATE_VERSION=0.3` in `.env` before updating. Back up
Postgres first: migrations run automatically at startup. Keep `APP_SECRET`
unchanged so existing Rivian tokens remain readable. See [CHANGELOG.md](CHANGELOG.md)
for release highlights and [RELEASING.md](RELEASING.md) for the release process.

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
