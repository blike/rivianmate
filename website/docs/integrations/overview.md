---
title: Integrations
sidebar_label: Overview
description: Ways to use RivianMate's data outside the app.
---

# Integrations

RivianMate keeps everything in plain PostgreSQL and has a public status endpoint, so it slots into
the rest of a homelab without any plugins.

| Integration                                              | What you get                                                                           |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [Grafana](./grafana.md)                                  | Fifteen ready-made dashboards: battery health, vampire drain, charging curves and more |
| [Discord and Apprise](../configuration/notifications.md) | Alerts to almost any messaging service                                                 |

Made something else? Share it on the [community projects](../community/projects.md) page.

## Ground rules for anything that reads the database

- **Use a read-only database user.** RivianMate's database also holds your password hash, encrypted
  Rivian tokens and notification settings. Grant `SELECT` on only the tables you need. Each guide
  here shows how.
- **Don't publish PostgreSQL to the internet.** Share a Docker network, or publish the port on
  `127.0.0.1` or your LAN only.
- **Treat the schema as internal.** Table layouts can change between releases. The Grafana
  dashboards in the repository are kept in step with the schema; your own queries may need updating
  after an upgrade. The [changelog](https://github.com/blike/rivianmate/blob/main/CHANGELOG.md)
  notes schema changes.

## Reaching the database

The bundled Compose file doesn't publish PostgreSQL's port. Either:

- **share a Docker network.** The network is named after the folder RivianMate runs from, usually
  `rivianmate_default` (check with `docker network ls`), and the host is `postgres:5432`; or
- **publish the port** on loopback or your LAN, with a `docker-compose.override.yml` next to
  RivianMate's Compose file:

  ```yaml title="docker-compose.override.yml"
  services:
    postgres:
      ports:
        - '127.0.0.1:5432:5432'
  ```

## The status endpoint

`GET /api/status` needs no sign-in, so monitoring tools can use it. Signed out, it reports only
whether setup is done and whether RivianMate is connected to Rivian. Among its fields:

```json
{
  "needsSetup": false,
  "authed": false,
  "rivianConnected": true,
  "rivianAuthState": null,
  "rivianEmail": null,
  "mockMode": false
}
```

The rest of the API needs a signed-in session and isn't meant as a public interface.
