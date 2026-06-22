import postgres from "postgres";

const initialSchemaSql = `
DO $$ BEGIN
  CREATE TYPE collector_status AS ENUM (
    'not_configured',
    'starting',
    'healthy',
    'degraded',
    'reauth_required',
    'rate_limited',
    'offline'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE confidence AS ENUM ('high', 'medium', 'low');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS local_admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL DEFAULT 'admin',
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS local_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL REFERENCES local_admin_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS local_sessions_token_hash_idx
  ON local_sessions(token_hash);
CREATE INDEX IF NOT EXISTS local_sessions_expires_at_idx
  ON local_sessions(expires_at);

CREATE TABLE IF NOT EXISTS rivian_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  encrypted_access_token text,
  encrypted_refresh_token text,
  encrypted_user_session_token text,
  status collector_status NOT NULL DEFAULT 'not_configured',
  last_refresh_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rivian_auth_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email text NOT NULL,
  csrf_token text NOT NULL,
  app_session_token text NOT NULL,
  otp_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rivian_auth_challenges_expires_at_idx
  ON rivian_auth_challenges(expires_at);

CREATE TABLE IF NOT EXISTS vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  rivian_vehicle_id text NOT NULL,
  vin text,
  name text NOT NULL,
  model text,
  trim text,
  model_year integer,
  software_version text,
  capabilities jsonb,
  enabled boolean NOT NULL DEFAULT true,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS vehicles_rivian_vehicle_id_idx
  ON vehicles(rivian_vehicle_id);
CREATE INDEX IF NOT EXISTS vehicles_account_idx
  ON vehicles(account_id);

CREATE TABLE IF NOT EXISTS vehicle_raw_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE CASCADE,
  source text NOT NULL,
  payload jsonb NOT NULL,
  parser_version text NOT NULL,
  dedupe_hash text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS vehicle_raw_events_dedupe_idx
  ON vehicle_raw_events(dedupe_hash);
CREATE INDEX IF NOT EXISTS vehicle_raw_events_received_idx
  ON vehicle_raw_events(received_at);

CREATE TABLE IF NOT EXISTS vehicle_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  raw_event_id uuid REFERENCES vehicle_raw_events(id) ON DELETE SET NULL,
  observed_at timestamptz NOT NULL,
  battery_level double precision,
  estimated_range_km double precision,
  charge_limit double precision,
  power_state text,
  charging_state text,
  latitude double precision,
  longitude double precision,
  speed_mps double precision,
  bearing double precision,
  altitude_meters double precision,
  drive_mode text,
  cabin_temperature_c double precision,
  outside_temperature_c double precision,
  raw jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS vehicle_snapshots_vehicle_observed_idx
  ON vehicle_snapshots(vehicle_id, observed_at);

CREATE TABLE IF NOT EXISTS drives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  start_date timestamptz NOT NULL,
  end_date timestamptz,
  start_latitude double precision,
  start_longitude double precision,
  end_latitude double precision,
  end_longitude double precision,
  start_label text,
  end_label text,
  distance_km double precision,
  duration_seconds integer,
  start_battery_level double precision,
  end_battery_level double precision,
  confidence confidence NOT NULL DEFAULT 'medium',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS drives_vehicle_start_idx
  ON drives(vehicle_id, start_date);

CREATE TABLE IF NOT EXISTS positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  drive_id uuid REFERENCES drives(id) ON DELETE SET NULL,
  observed_at timestamptz NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  altitude_meters double precision,
  speed_mps double precision,
  bearing double precision,
  battery_level double precision
);

CREATE INDEX IF NOT EXISTS positions_vehicle_observed_idx
  ON positions(vehicle_id, observed_at);
CREATE INDEX IF NOT EXISTS positions_drive_idx
  ON positions(drive_id);

CREATE TABLE IF NOT EXISTS charging_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  start_date timestamptz NOT NULL,
  end_date timestamptz,
  location_label text,
  start_battery_level double precision,
  end_battery_level double precision,
  energy_delivered_kwh double precision,
  range_added_km double precision,
  peak_power_kw double precision,
  cost double precision,
  currency text,
  confidence confidence NOT NULL DEFAULT 'medium',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS charging_sessions_vehicle_start_idx
  ON charging_sessions(vehicle_id, start_date);

CREATE TABLE IF NOT EXISTS charging_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  charging_session_id uuid REFERENCES charging_sessions(id) ON DELETE SET NULL,
  observed_at timestamptz NOT NULL,
  power_kw double precision,
  total_charged_energy_kwh double precision,
  range_added_km double precision,
  cost double precision,
  currency text,
  raw jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS charging_samples_vehicle_observed_idx
  ON charging_samples(vehicle_id, observed_at);

CREATE TABLE IF NOT EXISTS vehicle_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  state text NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vehicle_states_vehicle_started_idx
  ON vehicle_states(vehicle_id, started_at);

CREATE TABLE IF NOT EXISTS data_quality_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE CASCADE,
  category text NOT NULL,
  severity text NOT NULL,
  message text NOT NULL,
  raw jsonb,
  observed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS data_quality_events_observed_idx
  ON data_quality_events(observed_at);
`;

export async function migrateDatabase(databaseUrl: string) {
  const client = postgres(databaseUrl, {
    max: 1,
    onnotice: () => {},
    prepare: false
  });

  try {
    await client.unsafe(initialSchemaSql);
  } finally {
    await client.end();
  }
}
