---
title: Updating
description: Move to a newer RivianMate release.
---

# Updating

From the folder with your `docker-compose.yml`:

```bash
docker compose pull
docker compose up -d
```

Database migrations run automatically when the new version starts. The version you're running is
shown under **Settings → About**.

## Before you update

- [Back up the database](./backup-restore.md). Migrations change the schema, and going back to an
  older image afterwards needs the matching backup too.
- Keep your `.env`, especially `APP_SECRET`.
- Read the [changelog](https://github.com/blike/rivianmate/blob/main/CHANGELOG.md) for anything you
  have to do, such as new environment variables.

## Choosing when to update

`latest` moves with every stable release. To upgrade on your own schedule, pin a version in
`docker-compose.yml`, for example `mitchvitale/rivianmate:0.12`, and change it when you're ready. To
try changes before they're released, use `edge`; expect rough edges.

## Rolling back

Don't move back to an older image on its own after a release with migrations: the older version may
not understand the newer schema. Restore the backup you took before updating, then start the older
image.
