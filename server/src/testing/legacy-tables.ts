import type { Sql } from 'postgres';

/**
 * The tables state history replaced, as they were before conversion drops
 * them, for tests of the conversion and of old migrations. Tests share one
 * database, so whichever runs first may have dropped them.
 */
export async function ensureLegacyHistoryTables(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS vehicle_state_snapshots (
      id bigserial PRIMARY KEY,
      vehicle_id text NOT NULL REFERENCES vehicles(id),
      ts timestamptz NOT NULL,
      is_anchor boolean NOT NULL DEFAULT false,
      battery_level real,
      battery_limit real,
      range_km real,
      mileage_m double precision,
      power_state text,
      charger_status text,
      cabin_temp real,
      data jsonb NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS parallax_messages (
      id bigserial PRIMARY KEY,
      vehicle_id text NOT NULL REFERENCES vehicles(id),
      rvm text NOT NULL,
      payload text NOT NULL,
      message_at timestamptz,
      received_at timestamptz NOT NULL DEFAULT now()
    )
  `;
}
