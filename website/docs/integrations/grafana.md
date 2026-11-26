---
title: Grafana dashboards
sidebar_label: Grafana
description: Ready-made Grafana dashboards that read RivianMate's database.
---

# Grafana dashboards

If you already run Grafana, the repository ships fifteen dashboards that read RivianMate's database
directly. They're optional, change nothing in RivianMate, and Grafana itself isn't part of
RivianMate: you bring your own.

The dashboards are in
[`contrib/grafana/`](https://github.com/blike/rivianmate/tree/main/contrib/grafana).

## What's included

| Dashboard      | Shows                                                                          |
| -------------- | ------------------------------------------------------------------------------ |
| Overview       | Battery, range, odometer, power and charger state, and their history           |
| Battery Health | Estimated range at 100% charge over time, battery temperature                  |
| Vampire Drain  | Battery lost while parked and unplugged                                        |
| Mileage        | Odometer growth                                                                |
| Drives         | Drive history with mode, driver and efficiency, and totals; links to details   |
| Drive Details  | Route, speed, battery, mode, driver and efficiency for one drive               |
| Drive Stats    | Weekly distance and battery use; time, distance and efficiency by mode, driver |
| Charging       | Sessions, energy, cost, home against away charging                             |
| Charge Details | State of charge and power through one session                                  |
| Charging Curve | Power and state of charge for the latest session                               |
| Charging Stats | Weekly energy, cost and sessions, cost by saved location                       |
| Location       | Route map with your saved locations                                            |
| Visited        | Heatmap of where the vehicle has been                                          |
| OTA Timeline   | Software versions seen and their release notes                                 |
| Vehicle Health | Tires, doors, windows, climate, software and other status your vehicle reports |

Each dashboard shows one vehicle at a time, picked from a drop-down at the top. They follow the
app's rules: saved locations and their rates decide home charging and cost, and drives shorter than
0.1 km are left out.

## Requirements

- RivianMate **0.8.0 or newer**.
- Grafana with the PostgreSQL data source. Tested with Grafana 13.2.4; other versions may work.
- A network path from Grafana to RivianMate's PostgreSQL (see
  [Reaching the database](./overview.md#reaching-the-database)).

## 1. Create a read-only user

From RivianMate's folder, with a clone of the repository at hand:

```bash
docker compose exec -T postgres psql -U rivianmate -d rivianmate -v pw='choose-a-password' \
  < contrib/grafana/readonly-role.sql
```

This creates `grafana_ro`, with `SELECT` on the 14 tables the dashboards read and nothing else, and
a `grafana_settings()` function that returns only your units and currency so the dashboards match
the app. It's safe to run again after an update.

## 2. Add the data source

In Grafana: **Connections → Data sources → Add data source → PostgreSQL**.

| Field    | Value                                                |
| -------- | ---------------------------------------------------- |
| Name     | `RivianMate`                                         |
| Host URL | `postgres:5432` (or the host and port you published) |
| Database | `rivianmate`                                         |
| User     | `grafana_ro`                                         |
| Password | the password you chose                               |
| TLS/SSL  | `disable` inside a Docker network                    |

Or provision it from
[`provisioning/datasources/rivianmate.yml`](https://github.com/blike/rivianmate/blob/main/contrib/grafana/provisioning/datasources/rivianmate.yml),
with `RIVIANMATE_GRAFANA_PASSWORD` set in Grafana's environment.

## 3. Load the dashboards

Provisioning keeps them up to date as the repository changes:

```yaml title="Grafana's docker-compose.yml"
services:
  grafana:
    environment:
      RIVIANMATE_GRAFANA_PASSWORD: ${RIVIANMATE_GRAFANA_PASSWORD}
    volumes:
      - ./rivianmate/contrib/grafana/provisioning/datasources/rivianmate.yml:/etc/grafana/provisioning/datasources/rivianmate.yml:ro
      - ./rivianmate/contrib/grafana/provisioning/dashboards/rivianmate.yml:/etc/grafana/provisioning/dashboards/rivianmate.yml:ro
      - ./rivianmate/contrib/grafana:/var/lib/grafana/dashboards/rivianmate:ro
    networks: [default, rivianmate]

networks:
  rivianmate:
    external: true
    name: rivianmate_default
```

Restart Grafana and the dashboards appear in a **RivianMate** folder. They're re-read every five
minutes. Provisioned dashboards can't be saved over; use **Save as** for your own copy.

To load them by hand instead: **Dashboards → New → Import**, and upload each JSON file into one
folder.

The repository's [`docs/GRAFANA.md`](https://github.com/blike/rivianmate/blob/main/docs/GRAFANA.md)
has the same guide alongside the files.
