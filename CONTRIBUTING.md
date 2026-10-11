# Contributing to RivianMate

Thanks for helping out. Bug reports, fixes, and features are all welcome. For
anything larger than a small fix, open an issue first so we can agree on the
approach before you spend time on it.

To report a security problem, follow [SECURITY.md](SECURITY.md) instead of
opening an issue.

## Ground rules

RivianMate talks to a private Rivian API on behalf of real owners, so a few
rules apply to every change:

- **Read-only.** RivianMate never sends commands to the vehicle (unlock,
  climate, charging, and so on). Changes that add vehicle commands won't be
  accepted.
- **Gentle on Rivian.** Requests go through a shared governor that spaces
  them out and backs off when rate limited. New features should reuse data
  already received, prefer the WebSocket subscriptions over polling, and
  never poll tightly.
- **Private by default.** Nothing leaves the user's server except the
  outbound requests the README lists. Don't log tokens, passwords, VINs, or
  precise locations, and don't add telemetry or third-party services.

## Setting up

You need Node 22 or later, pnpm 10 (`corepack enable`), and Docker.

```sh
# Postgres on localhost:5433
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres

pnpm install
cp .env.example .env        # set APP_SECRET, uncomment DATABASE_URL and MOCK_RIVIAN

pnpm dev                    # API server on http://localhost:4000
pnpm dev:web                # web app with hot reload on http://localhost:5173
```

With `MOCK_RIVIAN=1` you don't need a Rivian account: any email and password
work, the verification code is `000000`, and a simulated R1S drives, parks
and charges so every page fills in. Use demo mode for screenshots and bug
reproductions so no real vehicle data ends up in the repository or in issues.

## Before opening a pull request

Run the same checks CI runs:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Database integration tests are skipped unless you point them at a
**disposable** Postgres, because they truncate its tables:

```sh
TEST_DATABASE_URL=postgres://… pnpm --filter @rivianmate/server test
```

Run them whenever you touch the schema, migrations, or anything that writes
to the database.

### Database changes

Edit [`server/src/db/schema.ts`](server/src/db/schema.ts), then generate a
migration and commit it with the change:

```sh
pnpm --filter @rivianmate/server db:generate
```

Migrations run automatically at startup on users' existing databases, so
they must work on real data: add columns with defaults or as nullable, and
backfill in the migration where needed.

## Code style

- TypeScript throughout, in strict mode. Avoid `any`.
- Format with Prettier: `pnpm format` (or `pnpm format:check` to check
  without writing). Configure your editor to format on save if you can.
- Match the code around your change: its naming, structure, and comment
  density. Comments explain why something is done, not what the code says.
- Put logic that can be tested in plain functions (for example
  `web/src/lib/` and `server/src/services/`) and add tests next to it as
  `*.test.ts`. Tests that need Postgres are named `*.db.test.ts`.
- In the web app, use the theme's CSS variables rather than fixed colors,
  in Tailwind's short form: `text-(--text-muted)`, `bg-(--surface-1)`, not
  `text-[var(--text-muted)]`. The Tailwind CSS editor extension suggests
  the canonical form of any class. Check your change on a phone-width
  screen as well as desktop.

## Pull requests

- Keep each pull request to one change, and fill in the template.
- Add screenshots for visible changes, taken in demo mode.
- Note anything users have to do when upgrading, such as new environment
  variables. Migrations run on their own.
- User-facing changes get a line in [CHANGELOG.md](CHANGELOG.md) at release
  time; mention them in the pull request.

## Reporting bugs and asking for features

Use the issue templates. For bugs, the RivianMate version, your vehicle
model, and the server logs around the problem help most. Remove tokens, your
VIN, and locations from anything you paste.
