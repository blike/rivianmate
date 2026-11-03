# Grafana dashboards

RivianMate's web interface covers live status and history. If you already run Grafana, this
repository also ships a set of dashboards that read RivianMate's PostgreSQL database directly:
battery health, vampire drain, charging curves, drive and charge statistics, location maps and more.
Each dashboard shows one vehicle at a time, picked from a drop-down at the top. They are optional,
they change nothing in RivianMate, and Grafana itself is not part of RivianMate: you bring your own.

The dashboards are in [`contrib/grafana/`](../contrib/grafana/).

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

They apply the same rules as the app: saved locations and their rates decide what counts as home
charging and what a session costs, and drives shorter than 0.1 km are left out.

## Requirements

- RivianMate **0.8.0 or newer**. The dashboards read the vehicle state history introduced in 0.8.0
  and the saved locations introduced in 0.6.0, so they do not work with older versions.
- Grafana with the PostgreSQL data source (`grafana-postgresql-datasource`). They have only been
  tested with Grafana 13.2.4; other versions may work but have not been tried.
- A network path from Grafana to RivianMate's PostgreSQL.

## 1. Let Grafana reach PostgreSQL

RivianMate's `docker-compose.yml` does not publish the database port, so Grafana needs a way in.
Either:

- **Share a Docker network** (recommended when Grafana also runs in Docker on the same host). Find
  the network with `docker network ls`; it is named after the folder RivianMate runs from, usually
  `rivianmate_default`. Attach your Grafana container to it and use `postgres:5432` as the host (see
  the Compose example in step 4).
- **Publish the port on the host's loopback.** Add this to a `docker-compose.override.yml` next to
  RivianMate's `docker-compose.yml`, then restart:
  `services: { postgres: { ports: ['127.0.0.1:5432:5432'] } }`. Use the host address from Grafana.
  Do not expose the port to the internet.

## 2. Create a read-only database user

You can point Grafana at the `rivianmate` user, but the database also holds the application password
hash, your encrypted Rivian tokens and notification settings. The dashboards need only 14 tables, so
give Grafana a user that can read just those:

```sh
docker compose exec -T postgres psql -U rivianmate -d rivianmate -v pw='choose-a-password' \
  < contrib/grafana/readonly-role.sql
```

This creates `grafana_ro` with `SELECT` on the tables the dashboards read and nothing else. It also
creates a `grafana_settings()` function that returns only your distance and temperature units and
currency from RivianMate's settings, which the dashboards use to show the same units as the app. The
script can be run again, for example after an update that adds a table the dashboards need.

If you use the application's own login instead, the defaults are database `rivianmate`, user
`rivianmate` and the password from `POSTGRES_PASSWORD` in your `.env` (`rivianmate` if you never set
one). Run the script anyway, so that `grafana_settings()` exists.

## 3. Add the data source

**Through the Grafana interface:** Connections, Data sources, Add data source, PostgreSQL.

| Field    | Value                                              |
| -------- | -------------------------------------------------- |
| Name     | `RivianMate`                                       |
| Host URL | `postgres:5432` (or the host and port from step 1) |
| Database | `rivianmate`                                       |
| User     | `grafana_ro`                                       |
| Password | the password you chose                             |
| TLS/SSL  | `disable` inside a Docker network                  |

Choose **Save & test**. If Grafana says there is no default database even though you filled the
field in, save the data source again; on some versions the database name has to be set in
`jsonData.database`, which the provisioning file below does.

**Or by file:** copy
[`provisioning/datasources/rivianmate.yml`](../contrib/grafana/provisioning/datasources/rivianmate.yml)
into Grafana's `/etc/grafana/provisioning/datasources/` and set `RIVIANMATE_GRAFANA_PASSWORD` in
Grafana's environment.

## 4. Load the dashboards

**Automatically (recommended).** Grafana can load a folder of dashboards and keep them up to date:

1. Copy
   [`provisioning/dashboards/rivianmate.yml`](../contrib/grafana/provisioning/dashboards/rivianmate.yml)
   into Grafana's `/etc/grafana/provisioning/dashboards/`.
2. Mount this repository's `contrib/grafana` folder, read-only, at
   `/var/lib/grafana/dashboards/rivianmate` in the Grafana container.

With Docker Compose, add this to your Grafana service (adjust the paths to where you cloned
RivianMate):

```yaml
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

Restart Grafana. The dashboards appear in a **RivianMate** folder within a few seconds and are
re-read every five minutes, so updating the folder updates Grafana. Provisioned dashboards cannot be
saved over from the interface; use **Save as** to keep a changed copy.

**Manually.** In Grafana choose Dashboards, New, Import, and upload each file from
`contrib/grafana/`. Put them in one folder; the navigation menu at the top of each dashboard links
the others by tag.

## Choosing the data source and vehicle

Each dashboard has a **Datasource** drop-down at the top. It selects your first PostgreSQL data
source; if you have several, pick the RivianMate one.

Next to it, the **Vehicle** drop-down lists every vehicle on your account by its name, or by its
model year and model if it has no name. It starts on the vehicle RivianMate added first. Every
panel, including the Location and Visited maps, shows only the vehicle you pick. The vehicle stays
selected when you move to another dashboard from the **RivianMate Dashboards** menu or open a drive
from the Drives table, and it is part of the page address, so a bookmark keeps it.

Drives and Drive Stats also have a **Driver** drop-down. It lists the drivers RivianMate has seen
from the vehicle's driver profiles, named as in the app, plus **Unknown** for drives where the
vehicle reported no profile. It starts on all of them; pick one or more to narrow every panel.

## Notes

- Units follow RivianMate's settings, as in the app: miles, mph, feet, psi and mi/kWh, or
  kilometres, km/h, metres, bar and kWh/100 km; °F or °C; and the currency of your charging
  settings. A column's unit is shown in its name, such as `Distance [mi]`. Change the units in
  RivianMate and reload the dashboard.
- Efficiency is an estimate: battery percentage used times pack capacity, per distance. It includes
  climate and other loads, and is noisy on short drives.
- Vehicles do not all report the same fields. A panel for something yours does not report shows "Not
  reported" or "No data".
- Saved locations, such as Home, belong to the account, so every vehicle's maps show the same ones.
- The dashboards follow RivianMate's database schema. After updating RivianMate, check the release
  notes, and if a panel shows a query error, update to the matching version of the dashboards. The
  database role in step 2 may need to be run again; it must be after the update that added
  `grafana_settings()`, or the unit drop-downs behind the panels fail to load.
- The data includes your vehicle's locations. Do not make your Grafana public.
