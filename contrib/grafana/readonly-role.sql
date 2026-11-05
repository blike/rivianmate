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
  drivers,
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

-- The display settings the dashboards follow (distance and temperature units, currency), with the
-- app's defaults, without granting read access to app_settings itself.
CREATE OR REPLACE FUNCTION grafana_settings()
RETURNS TABLE (distance text, temperature text, currency text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH s AS (
    SELECT key, value::jsonb AS v FROM app_settings
    WHERE key IN ('display_units', 'home_charging') AND pg_input_is_valid(value, 'jsonb')
  )
  SELECT
    COALESCE((SELECT v->>'distance' FROM s WHERE key = 'display_units' AND v->>'distance' IN ('mi', 'km')), 'mi'),
    COALESCE((SELECT v->>'temperature' FROM s WHERE key = 'display_units' AND v->>'temperature' IN ('F', 'C')), 'F'),
    COALESCE((SELECT v->>'currency' FROM s WHERE key = 'home_charging' AND v->>'currency' ~ '^[A-Z]{3}$'), 'USD')
$$;
REVOKE ALL ON FUNCTION grafana_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION grafana_settings() TO grafana_ro;
