-- Read-only database user for the RivianMate Grafana dashboards.
--
-- It can read only the tables the dashboards query. It cannot read the application password hash,
-- the encrypted Rivian tokens or the notification settings, and it cannot change anything.
--
-- Run it once against the RivianMate database, passing the password for the new user:
--
--   docker compose exec -T postgres psql -U rivianmate -d rivianmate -v pw='choose-a-password' \
--     < contrib/grafana/readonly-role.sql
--
-- It is safe to run again, for example after an update adds a table the dashboards need.

SELECT format('CREATE ROLE grafana_ro LOGIN PASSWORD %L', :'pw')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'grafana_ro')
\gexec

GRANT CONNECT ON DATABASE rivianmate TO grafana_ro;
GRANT USAGE ON SCHEMA public TO grafana_ro;

GRANT SELECT ON
  vehicles,
  drives,
  location_points,
  saved_locations,
  charging_sessions,
  charging_curve_points,
  wallboxes,
  wallbox_readings,
  state_changes,
  state_fields,
  state_heartbeats,
  parallax_latest,
  ota_release_notes
TO grafana_ro;
