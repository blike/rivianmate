---
title: Backup & restore
description: Back up and restore RivianMate's PostgreSQL database.
---

# Backup & restore

Everything RivianMate knows is in its PostgreSQL database. Back it up, and keep a copy of your
`.env` (with `APP_SECRET`) beside it: the backup holds encrypted Rivian tokens that can only be read
with that secret.

## Back up

From the folder with your `docker-compose.yml`:

```bash
docker compose exec -T postgres pg_dump -U rivianmate -d rivianmate -Fc > rivianmate-$(date +%F).dump
```

`-Fc` writes PostgreSQL's compressed custom format. The app can keep running while this runs.

To take one every night, add a cron job on the host:

```bash title="crontab -e"
0 3 * * * cd /path/to/rivianmate && docker compose exec -T postgres pg_dump -U rivianmate -d rivianmate -Fc > backups/rivianmate-$(date +\%F).dump
```

Keep backups somewhere other than the same disk, and delete old ones on a schedule.

## Restore

Restoring replaces everything in the database with the backup.

```bash
# 1. Stop the app so nothing writes while restoring
docker compose stop rivianmate

# 2. Recreate an empty database
docker compose exec -T postgres psql -U rivianmate -d postgres \
  -c 'DROP DATABASE IF EXISTS rivianmate;' -c 'CREATE DATABASE rivianmate;'

# 3. Load the backup
docker compose exec -T postgres pg_restore -U rivianmate -d rivianmate --no-owner < rivianmate-2026-11-25.dump

# 4. Start the app again
docker compose start rivianmate
```

Use the same `APP_SECRET` the backup was taken with, or you'll have to sign in to Rivian again.

## Moving to a new server

1. Back up on the old server and copy the `.dump` file and `.env` across.
2. Install on the new server as in [Docker Compose](./docker.md), using the same `.env`.
3. Run `docker compose up -d postgres`, then the restore steps above, then `docker compose up -d`.

## Upgrading PostgreSQL

A new major version of PostgreSQL can't open the old version's data folder. To move between major
versions, back up, change the `postgres` image tag, remove the old volume (`docker compose down`
then `docker volume rm rivianmate_postgres_data`; check the name with `docker volume ls`), start the
new `postgres`, and restore.

:::danger

Removing the volume deletes the database. Check that the backup restores before you do it.

:::
