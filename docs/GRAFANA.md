# Grafana Dashboards

RivianMate's own web UI covers live status and history, but if you already run a
Grafana + Postgres stack (à la [Teslamate](https://github.com/teslamate-org/teslamate)),
this directory has a ready-made set of 13 dashboards built directly against
RivianMate's schema — no extra services, no schema changes, just read-only
queries against the database RivianMate already writes to.

## What's included

| Dashboard | Shows |
|---|---|
| Overview | Live battery, range, odometer, power/charger state, battery & range history |
| Charging | Session table, energy/cost stats, energy-per-session, wallbox power |
| Charge Details | Per-session SoC ramp + wallbox power curve (pick a session from a dropdown) |
| Charging Stats | Weekly energy/cost/session-count trends, lifetime totals |
| Drives | Drive history table (links to Drive Details), distance stats |
| Drive Details | Route map, speed & altitude for a single selected drive |
| Drive Stats | Weekly distance/drive-count/battery-used trends, lifetime totals |
| Mileage | Odometer growth over time |
| Battery Health | Estimated range-at-100% trend (degradation proxy), color-coded by charge level, with a linear regression trend line |
| Vampire Drain | Battery loss while parked & unplugged, estimated %/day drain rate |
| Location | Geomap route track, current speed/bearing/altitude |
| Visited | Heatmap of everywhere the vehicle has been |
| Vehicle Health | Tire pressure, doors, windows, closures, climate, OTA, gear guard and more — everything in the raw API state that doesn't have its own database column (see [`VEHICLE_DATA_FIELDS.md`](./VEHICLE_DATA_FIELDS.md)) |

All 13 are cross-linked via a dropdown nav at the top of each dashboard (Grafana's
tag-based dashboard links, tag `rivianmate` — this works automatically as long as
you import all of them with that tag intact, which the JSON already has set).

## Setup

1. **Add a Postgres datasource** in Grafana pointing at RivianMate's database —
   the same one `DATABASE_URL` in your `.env` points to.
   - Host/port: wherever Postgres is reachable from your Grafana instance (if
     they're in the same Docker Compose project you can use the service name;
     otherwise you'll need to publish Postgres's port, e.g. add
     `ports: ["5433:5432"]` to the `postgres` service in `docker-compose.yml`)
   - Database / User / Password: same as `POSTGRES_DB` / `POSTGRES_USER` /
     `POSTGRES_PASSWORD`
   - SSL mode: `disable` (unless you've set up TLS yourself)
   - **Gotcha:** on at least some Grafana versions, the Postgres datasource
     plugin reads the database name from `jsonData.database`, not the
     top-level `database` field the settings UI writes to by default. If you
     get *"You do not currently have a default database configured for this
     data source"* even though you filled in the Database field, re-save the
     datasource — if the error persists, set the database name via the
     datasource provisioning YAML/API directly in `jsonData.database`.

2. **Import each dashboard**: Grafana → Dashboards → New → Import → upload (or
   paste) one of the JSON files in this folder. You'll be prompted to pick a
   datasource for the single input, `DS_RIVIANMATE` — choose the datasource
   from step 1. Repeat for all 13 files (import order doesn't matter; the
   cross-links resolve by dashboard UID, which is fixed in each file).

3. Put them all in the same Grafana folder if you'd like them grouped, though
   this isn't required — the dropdown nav works across folders.

## Notes / limitations

- Distances are in **miles** (matches RivianMate's own web UI, which is
  mile-primary). If you'd rather see km, the SQL in each panel does the
  conversion explicitly (e.g. `distance_km * 0.621371`) — just remove the
  multiplier and rename the field/axis labels.
- The **Vehicle Health** dashboard queries fields (tire pressure, door state,
  OTA version, etc.) that come from the raw `vehicle_state_snapshots.data`
  jsonb column — RivianMate stores the *full* raw Rivian API response there
  (see `snapshot-writer.ts`), so these fields should populate automatically
  on a real vehicle connection. They were built and tested only against
  `MOCK_RIVIAN=1` data, though, so field names/shapes are unverified against
  a real account — please report back if anything differs.
- **Battery Health**'s "range at 100%" is a derived estimate
  (`range / (battery_level / 100)`), the same technique Teslamate uses — it's
  not a true battery-health signal from the vehicle (no EV maker exposes
  that), just a proxy that trends downward if the pack degrades.
