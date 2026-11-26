---
title: Development setup
sidebar_label: Development setup
description: Run RivianMate from source, with a simulated vehicle.
---

# Development setup

RivianMate is TypeScript from end to end.

| Part     | Built with                          |
| -------- | ----------------------------------- |
| Web app  | React, Vite, Tailwind CSS, MapLibre |
| Server   | Node.js, Fastify                    |
| Database | PostgreSQL, Drizzle ORM             |
| Shipping | Docker, Docker Compose              |

## Requirements

- Node.js 22 or later
- pnpm 10 (`corepack enable`)
- Docker, for PostgreSQL

## Run it

```bash
git clone https://github.com/blike/rivianmate.git
cd rivianmate

# PostgreSQL on localhost:5433
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres

pnpm install
cp .env.example .env   # set APP_SECRET, uncomment DATABASE_URL and MOCK_RIVIAN
```

Then, in two terminals:

```bash
pnpm dev       # API server on http://localhost:4000
```

```bash
pnpm dev:web   # web app with hot reload on http://localhost:5173
```

## Demo mode

With `MOCK_RIVIAN=1` you don't need a Rivian account:

- any email and password sign in,
- the verification code is `000000`,
- a simulated R1S drives, parks and charges, so every page fills in.

Use demo mode for screenshots and bug reproductions, so no real vehicle data ends up in the
repository or in issues.

For a longer history, record the demo scene into a demo database:

```bash
pnpm --filter @rivianmate/server demo:scene
```

then start with `MOCK_SCENE=drive-home`. It writes about two and three-quarter years of drives and
charges, so History's longer periods can be screenshotted too. The script's header has the details.

## Repository layout

```text
rivianmate/
├── server/            Fastify API, Rivian client, database schema and migrations
│   ├── src/
│   └── drizzle/       generated migrations
├── web/               React app, organized by feature
│   └── src/
│       ├── features/  one folder per page
│       ├── components/ shared components
│       └── lib/       shared logic
├── contrib/grafana/   optional Grafana dashboards
├── docs/              repository docs and screenshots
├── website/           this documentation site (not part of the Docker image)
├── Dockerfile
└── docker-compose.yml
```

## Checks

Run what CI runs before opening a pull request:

```bash
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Database integration tests are skipped unless you point them at a **disposable** PostgreSQL, because
they truncate its tables:

```bash
TEST_DATABASE_URL=postgres://… pnpm --filter @rivianmate/server test
```

Run them whenever you touch the schema, migrations or anything that writes to the database.

## Database changes

Edit `server/src/db/schema.ts`, then generate a migration and commit it with the change:

```bash
pnpm --filter @rivianmate/server db:generate
```

Migrations run at startup on people's existing databases, so they have to work on real data: add
columns with defaults or as nullable, and backfill in the migration where needed.
