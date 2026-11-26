---
title: Privacy & security
description: What RivianMate stores, how it's protected, and what it sends elsewhere.
---

# Privacy & security

RivianMate is built to keep your vehicle data under your control.

## What's protected, and how

- **Local storage.** Vehicle data and history are stored in your own PostgreSQL database.
- **Encrypted tokens.** Your Rivian password is used to sign in and never stored. The tokens Rivian
  returns are encrypted with AES-256-GCM using your `APP_SECRET`.
- **App password.** The web interface is protected by a password hashed with scrypt, and sign-in
  attempts are throttled.
- **Read-only vehicle access.** RivianMate never sends commands to the vehicle.
- **Isolated database.** The bundled PostgreSQL is reachable only inside the Docker network.
- **No telemetry.** RivianMate doesn't send your data to any RivianMate-run analytics or cloud
  service.
- **Clean logs.** Logs never include tokens, passwords, your email or vehicle locations.

## Outside services

RivianMate connects to:

| Service                                             | Why                                                                           | Optional |
| --------------------------------------------------- | ----------------------------------------------------------------------------- | -------- |
| Rivian                                              | Vehicle data and sign-in                                                      | No       |
| [OpenFreeMap](https://openfreemap.org/)             | Map tiles, loaded by your browser                                             | No       |
| [Nominatim](https://nominatim.org/) (OpenStreetMap) | Addresses for where drives start and end; place search when saving a location | Yes      |
| [Open-Meteo](https://open-meteo.com/)               | The weather on each drive                                                     | Yes      |
| Discord or your Apprise server                      | Notifications, if you set them up                                             | Yes      |

Choose address and weather lookups during setup, or later under **Settings → General → Outside
services**:

- **Addresses** sends where each drive starts and ends. When off, places you haven't saved show as
  coordinates.
- **Weather** sends a point every 10 minutes along each drive, and the drive's date. It doesn't send
  times of day: your server matches the readings to the drive's times. When off, drives have no
  weather.

Neither sends your account, name or vehicle details. Place search runs only when you search.

## Hardening checklist

- Keep RivianMate behind [HTTPS or a private network](./installation/reverse-proxy.md); never
  forward port 4000 to the internet.
- Use a strong `POSTGRES_PASSWORD` and a random `APP_SECRET`.
- Give anything else that reads the database a [read-only user](./integrations/overview.md).
- Keep backups somewhere safe: they contain your location history and encrypted tokens.
- Stay on the latest release. Only the latest is supported with security fixes.

## Reporting a vulnerability

Don't open a public issue. Report it privately through
[GitHub's security advisories](https://github.com/blike/rivianmate/security/advisories/new). The
[security policy](https://github.com/blike/rivianmate/security/policy) says what's in scope and what
to include.
