---
title: Environment variables
description: Every environment variable RivianMate reads.
---

# Environment variables

RivianMate is configured with environment variables, set in the `.env` file next to
`docker-compose.yml`. Compose reads it on `docker compose up`. Restart after changing it:

```bash
docker compose up -d
```

| Variable            | Required    | Default        | Description                                                                                                                                        |
| ------------------- | ----------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_SECRET`        | Yes         |                | At least 32 random characters. Encrypts Rivian tokens and signs sessions. Generate with `openssl rand -hex 32`. Must stay the same across updates. |
| `POSTGRES_PASSWORD` | Recommended | `rivianmate`   | Password for the bundled PostgreSQL database.                                                                                                      |
| `APP_PORT`          | No          | `4000`         | Host port for the web interface.                                                                                                                   |
| `APP_PASSWORD`      | No          |                | Sets the RivianMate password on first startup, skipping that setup step. At least 12 characters, and not a common password or pattern.             |
| `DATABASE_URL`      | No          | set by Compose | PostgreSQL connection string. Override it to use your own PostgreSQL server.                                                                       |
| `LOG_LEVEL`         | No          | `info`         | `error`, `warn`, `info` or `debug`. `debug` adds every HTTP request and routine live-stream renewals.                                              |
| `LOG_FORMAT`        | No          | `pretty`       | `pretty` for readable `docker logs`, or `json` for one object per line, for log collectors.                                                        |
| `TZ`                | No          | `UTC`          | Time zone for times in log messages, such as `America/Los_Angeles`. Dates in the app always follow your browser.                                   |

## Development only

These are for working on RivianMate itself, not for a normal install:

| Variable      | Description                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------- |
| `MOCK_RIVIAN` | `1` replaces Rivian with a simulated R1S. See [Development](../contributing/development.md). |
| `MOCK_SCENE`  | Starts the mock from a recorded demo scene, such as `drive-home`.                            |

## Using your own PostgreSQL

Remove the `postgres` service from the Compose file (and the `depends_on` that points at it) and set
`DATABASE_URL`:

```ini title=".env"
DATABASE_URL=postgres://rivianmate:password@db.internal:5432/rivianmate
```

The user needs to own the database, since RivianMate creates and migrates its own tables.

## Logs

Logs go to the container's output:

```bash
docker compose logs -t rivianmate
```

They never include tokens, passwords, your email or vehicle locations. You can also download them
from **Settings → Logs**. When reporting a bug, set `LOG_LEVEL=debug`, reproduce the problem and
attach the logs.
