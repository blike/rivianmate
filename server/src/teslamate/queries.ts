/**
 * Read-only queries against TeslaMate's database. TeslaMate stores times as
 * UTC in `timestamp` columns without a zone, so every time is read with
 * `AT TIME ZONE 'UTC'` and compared the same way; numeric columns are cast
 * to float8 so they arrive as numbers.
 */
import type postgres from 'postgres';
import type {
  ActivityInterval,
  ActiveChargeRow,
  CapacityRow,
  CarRow,
  ChargeRow,
  ChargingProcessRow,
  DriveRow,
  GeofenceRow,
  PositionRow,
  RangeKind,
  StateRow,
} from './mapping.js';

export type Sql = postgres.Sql;

/** Optional columns, added in later TeslaMate versions. */
export interface Columns {
  tpms: boolean;
  marketingName: boolean;
}

const REQUIRED_TABLES = [
  'cars',
  'positions',
  'drives',
  'charging_processes',
  'charges',
  'states',
  'addresses',
  'geofences',
  'updates',
] as const;

export class NotTeslaMateError extends Error {}

/**
 * Checks the database is TeslaMate's and the session is read-only, and
 * finds which optional columns exist.
 */
export async function probe(sql: Sql): Promise<Columns> {
  const [ro] = await sql<{ transaction_read_only: string }[]>`SHOW transaction_read_only`;
  if (ro?.transaction_read_only !== 'on') {
    throw new Error('The connection is not read-only.');
  }
  const tables = await sql<{ name: string }[]>`
    SELECT table_name AS name FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name IN ${sql(REQUIRED_TABLES)}
  `;
  const found = new Set(tables.map((t) => t.name));
  const missing = REQUIRED_TABLES.filter((t) => !found.has(t));
  if (missing.length > 0) {
    throw new NotTeslaMateError(
      `This doesn't look like TeslaMate's database (no ${missing.slice(0, 3).join(', ')} table${missing.length > 1 ? 's' : ''}).`,
    );
  }
  const columns = await sql<{ table: string; column: string }[]>`
    SELECT table_name AS table, column_name AS column FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND ((table_name = 'positions' AND column_name = 'tpms_pressure_fl')
        OR (table_name = 'cars' AND column_name = 'marketing_name'))
  `;
  return {
    tpms: columns.some((c) => c.column === 'tpms_pressure_fl'),
    marketingName: columns.some((c) => c.column === 'marketing_name'),
  };
}

export function cars(sql: Sql, columns: Columns): Promise<CarRow[]> {
  return sql<CarRow[]>`
    SELECT id::int AS id, name, model, vin, efficiency::float8 AS efficiency,
           ${columns.marketingName ? sql`marketing_name` : sql`NULL::text`} AS marketing_name
    FROM cars ORDER BY id
  `;
}

export function geofences(sql: Sql): Promise<GeofenceRow[]> {
  return sql<GeofenceRow[]>`
    SELECT name, latitude::float8 AS latitude, longitude::float8 AS longitude, radius::float8 AS radius
    FROM geofences
  `;
}

export async function preferredRange(sql: Sql): Promise<RangeKind> {
  const [row] = await sql<{ preferred_range: string | null }[]>`
    SELECT preferred_range::text AS preferred_range FROM settings ORDER BY id LIMIT 1
  `.catch(() => []);
  return row?.preferred_range === 'ideal' ? 'ideal' : 'rated';
}

const utc = (sql: Sql, column: string) => sql`(${sql(column)} AT TIME ZONE 'UTC')`;
const at = (sql: Sql, date: Date) => sql`(${date.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

function positionColumns(sql: Sql, columns: Columns) {
  const tpms = columns.tpms
    ? sql`tpms_pressure_fl::float8 AS tpms_pressure_fl, tpms_pressure_fr::float8 AS tpms_pressure_fr,
          tpms_pressure_rl::float8 AS tpms_pressure_rl, tpms_pressure_rr::float8 AS tpms_pressure_rr`
    : sql`NULL::float8 AS tpms_pressure_fl, NULL::float8 AS tpms_pressure_fr,
          NULL::float8 AS tpms_pressure_rl, NULL::float8 AS tpms_pressure_rr`;
  return sql`
    ${utc(sql, 'date')} AS date, latitude::float8 AS latitude, longitude::float8 AS longitude,
    speed, power, odometer::float8 AS odometer,
    ideal_battery_range_km::float8 AS ideal_battery_range_km,
    rated_battery_range_km::float8 AS rated_battery_range_km,
    battery_level, usable_battery_level,
    outside_temp::float8 AS outside_temp, inside_temp::float8 AS inside_temp,
    driver_temp_setting::float8 AS driver_temp_setting,
    passenger_temp_setting::float8 AS passenger_temp_setting, fan_status,
    is_climate_on, is_front_defroster_on, is_rear_defroster_on, elevation,
    ${tpms}
  `;
}

/** Latest full vehicle report; uses TeslaMate's (car_id, date) partial index. */
export async function latestFullPosition(
  sql: Sql,
  columns: Columns,
  carId: number,
): Promise<PositionRow | null> {
  const [row] = await sql<PositionRow[]>`
    SELECT ${positionColumns(sql, columns)} FROM positions
    WHERE car_id = ${carId} AND ideal_battery_range_km IS NOT NULL
    ORDER BY date DESC LIMIT 1
  `;
  return row ?? null;
}

export async function drivePositionEdges(
  sql: Sql,
  columns: Columns,
  driveId: number,
): Promise<{ first: PositionRow | null; latest: PositionRow | null }> {
  const [first] = await sql<PositionRow[]>`
    SELECT ${positionColumns(sql, columns)} FROM positions
    WHERE drive_id = ${driveId} ORDER BY date ASC LIMIT 1
  `;
  const [latest] = await sql<PositionRow[]>`
    SELECT ${positionColumns(sql, columns)} FROM positions
    WHERE drive_id = ${driveId} ORDER BY date DESC LIMIT 1
  `;
  return { first: first ?? null, latest: latest ?? null };
}

export async function latestFullDrivePosition(
  sql: Sql,
  columns: Columns,
  driveId: number,
): Promise<PositionRow | null> {
  const [row] = await sql<PositionRow[]>`
    SELECT ${positionColumns(sql, columns)} FROM positions
    WHERE drive_id = ${driveId} AND ideal_battery_range_km IS NOT NULL
    ORDER BY date DESC LIMIT 1
  `;
  return row ?? null;
}

export async function currentState(sql: Sql, carId: number): Promise<StateRow | null> {
  const [row] = await sql<StateRow[]>`
    SELECT state::text AS state, ${utc(sql, 'start_date')} AS start_date,
           ${utc(sql, 'end_date')} AS end_date
    FROM states WHERE car_id = ${carId} ORDER BY start_date DESC LIMIT 1
  `;
  return row ?? null;
}

export async function openDrive(
  sql: Sql,
  carId: number,
): Promise<{ id: number; started_at: Date } | null> {
  const [row] = await sql<{ id: number; started_at: Date }[]>`
    SELECT id::int AS id, ${utc(sql, 'start_date')} AS started_at FROM drives
    WHERE car_id = ${carId} AND end_date IS NULL ORDER BY start_date DESC LIMIT 1
  `;
  return row ?? null;
}

export async function openCharge(sql: Sql, carId: number): Promise<ActiveChargeRow | null> {
  const [row] = await sql<ActiveChargeRow[]>`
    SELECT id::int AS id, ${utc(sql, 'start_date')} AS start_date, start_battery_level,
           start_ideal_range_km::float8 AS start_ideal_range_km,
           start_rated_range_km::float8 AS start_rated_range_km
    FROM charging_processes
    WHERE car_id = ${carId} AND end_date IS NULL ORDER BY start_date DESC LIMIT 1
  `;
  return row ?? null;
}

const chargeColumns = (sql: Sql) => sql`
  ${utc(sql, 'date')} AS date, battery_level, charge_energy_added::float8 AS charge_energy_added,
  charger_power, charger_voltage, charger_actual_current, fast_charger_present,
  ideal_battery_range_km::float8 AS ideal_battery_range_km,
  rated_battery_range_km::float8 AS rated_battery_range_km
`;

export async function latestCharge(sql: Sql, processId: number): Promise<ChargeRow | null> {
  const [row] = await sql<ChargeRow[]>`
    SELECT ${chargeColumns(sql)} FROM charges
    WHERE charging_process_id = ${processId} ORDER BY date DESC LIMIT 1
  `;
  return row ?? null;
}

export async function latestVersion(
  sql: Sql,
  carId: number,
): Promise<{ version: string; at: Date } | null> {
  const [row] = await sql<{ version: string; at: Date }[]>`
    SELECT version, ${utc(sql, 'start_date')} AS at FROM updates
    WHERE car_id = ${carId} AND version IS NOT NULL ORDER BY start_date DESC LIMIT 1
  `;
  return row ?? null;
}

const address = (sql: Sql, alias: string) => sql`
  CASE WHEN ${sql(alias)}.id IS NULL THEN NULL ELSE json_build_object(
    'name', ${sql(alias)}.name, 'house_number', ${sql(alias)}.house_number,
    'road', ${sql(alias)}.road, 'city', ${sql(alias)}.city,
    'display_name', ${sql(alias)}.display_name
  ) END
`;

function driveSelect(sql: Sql) {
  return sql`
    SELECT d.id::int AS id, (d.start_date AT TIME ZONE 'UTC') AS started_at,
           (d.end_date AT TIME ZONE 'UTC') AS ended_at,
           d.distance::float8 AS distance, d.start_km::float8 AS start_km, d.speed_max,
           d.ascent, d.descent, d.outside_temp_avg::float8 AS outside_temp_avg,
           d.start_ideal_range_km::float8 AS start_ideal_range_km,
           d.end_ideal_range_km::float8 AS end_ideal_range_km,
           d.start_rated_range_km::float8 AS start_rated_range_km,
           d.end_rated_range_km::float8 AS end_rated_range_km,
           sp.latitude::float8 AS start_lat, sp.longitude::float8 AS start_lon,
           sp.battery_level AS start_battery,
           ep.latitude::float8 AS end_lat, ep.longitude::float8 AS end_lon,
           ep.battery_level AS end_battery,
           sg.name AS start_geofence, eg.name AS end_geofence,
           ${address(sql, 'sa')} AS start_address, ${address(sql, 'ea')} AS end_address
    FROM drives d
    LEFT JOIN positions sp ON sp.id = d.start_position_id
    LEFT JOIN positions ep ON ep.id = d.end_position_id
    LEFT JOIN addresses sa ON sa.id = d.start_address_id
    LEFT JOIN addresses ea ON ea.id = d.end_address_id
    LEFT JOIN geofences sg ON sg.id = d.start_geofence_id
    LEFT JOIN geofences eg ON eg.id = d.end_geofence_id
  `;
}

/** Started within the window's ends, where it has them. */
function startedIn(sql: Sql, column: string, window: ListWindow) {
  return sql`
    ${window.from ? sql`AND ${sql(column)} >= ${at(sql, window.from)}` : sql``}
    ${window.to ? sql`AND ${sql(column)} <= ${at(sql, window.to)}` : sql``}
    ${window.before ? sql`AND ${sql(column)} < ${at(sql, window.before)}` : sql``}
  `;
}

export interface ListWindow {
  from?: Date;
  to?: Date;
  /** Only those that started before this: the next page. */
  before?: Date;
  limit: number;
}

export function drives(sql: Sql, carId: number, window: ListWindow): Promise<DriveRow[]> {
  return sql<DriveRow[]>`
    ${driveSelect(sql)} WHERE d.car_id = ${carId} ${startedIn(sql, 'd.start_date', window)}
    ORDER BY d.start_date DESC LIMIT ${window.limit}
  `;
}

export async function firstDriveStart(sql: Sql, carId: number): Promise<Date | null> {
  const [row] = await sql<{ started_at: Date | null }[]>`
    SELECT MIN(${utc(sql, 'start_date')}) AS started_at FROM drives WHERE car_id = ${carId}
  `;
  return row?.started_at ?? null;
}

export async function drive(sql: Sql, carId: number, driveId: number): Promise<DriveRow | null> {
  const [row] = await sql<DriveRow[]>`
    ${driveSelect(sql)} WHERE d.car_id = ${carId} AND d.id = ${driveId}
  `;
  return row ?? null;
}

export interface PointRow {
  ts: Date;
  lat: number;
  lon: number;
  speed: number | null;
  elevation: number | null;
}

export function drivePoints(sql: Sql, driveId: number, limit: number): Promise<PointRow[]> {
  return sql<PointRow[]>`
    SELECT ${utc(sql, 'date')} AS ts, latitude::float8 AS lat, longitude::float8 AS lon,
           speed, elevation
    FROM positions WHERE drive_id = ${driveId} ORDER BY date LIMIT ${limit}
  `;
}

export async function driveMaxSpeed(sql: Sql, driveId: number): Promise<number | null> {
  const [row] = await sql<{ max: number | null }[]>`
    SELECT MAX(speed)::int AS max FROM positions WHERE drive_id = ${driveId}
  `;
  return row?.max ?? null;
}

export function chargingProcesses(
  sql: Sql,
  carId: number,
  window: ListWindow,
): Promise<ChargingProcessRow[]> {
  return sql<ChargingProcessRow[]>`
    SELECT cp.id::int AS id, (cp.start_date AT TIME ZONE 'UTC') AS started_at,
           (cp.end_date AT TIME ZONE 'UTC') AS ended_at,
           cp.charge_energy_added::float8 AS charge_energy_added,
           cp.charge_energy_used::float8 AS charge_energy_used,
           cp.start_battery_level, cp.end_battery_level, cp.duration_min,
           cp.start_ideal_range_km::float8 AS start_ideal_range_km,
           cp.end_ideal_range_km::float8 AS end_ideal_range_km,
           cp.start_rated_range_km::float8 AS start_rated_range_km,
           cp.end_rated_range_km::float8 AS end_rated_range_km,
           cp.cost::float8 AS cost,
           COALESCE(p.latitude, a.latitude)::float8 AS lat,
           COALESCE(p.longitude, a.longitude)::float8 AS lon,
           g.name AS geofence, ${address(sql, 'a')} AS address,
           agg.max_power, agg.fast, agg.brand,
           latest.battery_level AS latest_battery_level,
           latest.charge_energy_added::float8 AS latest_energy,
           latest.ideal_battery_range_km::float8 AS latest_ideal_range_km,
           latest.rated_battery_range_km::float8 AS latest_rated_range_km
    FROM charging_processes cp
    LEFT JOIN positions p ON p.id = cp.position_id
    LEFT JOIN addresses a ON a.id = cp.address_id
    LEFT JOIN geofences g ON g.id = cp.geofence_id
    LEFT JOIN LATERAL (
      SELECT MAX(charger_power)::int AS max_power, bool_or(fast_charger_present) AS fast,
             MAX(fast_charger_brand) AS brand
      FROM charges WHERE charging_process_id = cp.id
    ) agg ON true
    LEFT JOIN LATERAL (
      SELECT battery_level, charge_energy_added, ideal_battery_range_km, rated_battery_range_km
      FROM charges WHERE charging_process_id = cp.id AND cp.end_date IS NULL
      ORDER BY date DESC LIMIT 1
    ) latest ON true
    WHERE cp.car_id = ${carId} ${startedIn(sql, 'cp.start_date', window)}
    ORDER BY cp.start_date DESC LIMIT ${window.limit}
  `;
}

export interface CurveRow {
  ts: Date;
  power_kw: number | null;
  soc: number | null;
}

export function chargeCurve(sql: Sql, carId: number, processId: number): Promise<CurveRow[]> {
  return sql<CurveRow[]>`
    SELECT (c.date AT TIME ZONE 'UTC') AS ts, c.charger_power::float8 AS power_kw,
           c.battery_level::float8 AS soc
    FROM charges c JOIN charging_processes cp ON cp.id = c.charging_process_id
    WHERE cp.id = ${processId} AND cp.car_id = ${carId}
    ORDER BY c.date LIMIT 20000
  `;
}

export type HistoryMetric = 'battery' | 'range' | 'mileage';

const metricColumn = (sql: Sql, metric: HistoryMetric, range: RangeKind) =>
  metric === 'battery'
    ? sql`battery_level::float8`
    : metric === 'mileage'
      ? sql`(odometer * 1000)::float8`
      : range === 'ideal'
        ? sql`ideal_battery_range_km::float8`
        : sql`rated_battery_range_km::float8`;

const MAX_RAW_POINTS = 5000;

/**
 * Battery, range or odometer over time from full reports. "raw" is thinned
 * evenly to at most MAX_RAW_POINTS: TeslaMate logs far more often than
 * Rivian's snapshots.
 */
export function history(
  sql: Sql,
  carId: number,
  q: { metric: HistoryMetric; from: Date; to: Date; interval: string | null; range: RangeKind },
): Promise<{ bucket: Date; avg: number | null; min: number | null; max: number | null }[]> {
  const value = metricColumn(sql, q.metric, q.range);
  const where = sql`
    car_id = ${carId} AND ideal_battery_range_km IS NOT NULL
    AND date BETWEEN ${at(sql, q.from)} AND ${at(sql, q.to)}
  `;
  if (q.interval == null) {
    return sql`
      SELECT bucket, value AS avg, value AS min, value AS max FROM (
        SELECT ${utc(sql, 'date')} AS bucket, ${value} AS value,
               ROW_NUMBER() OVER (ORDER BY date) AS rn, COUNT(*) OVER () AS n
        FROM positions WHERE ${where}
      ) p
      WHERE value IS NOT NULL
        AND (rn % CEIL(n / ${MAX_RAW_POINTS}::float8)::int = 0 OR rn = n OR rn = 1)
      ORDER BY bucket
    `;
  }
  return sql`
    SELECT (date_bin(${q.interval}::interval, date, TIMESTAMP '2020-01-01') AT TIME ZONE 'UTC') AS bucket,
           AVG(${value})::float8 AS avg, MIN(${value})::float8 AS min, MAX(${value})::float8 AS max
    FROM positions WHERE ${where}
    GROUP BY 1 HAVING COUNT(${value}) > 0 ORDER BY 1
  `;
}

export function chargeIntervals(
  sql: Sql,
  carId: number,
  from: Date,
  to: Date,
): Promise<{ from: Date; to: Date }[]> {
  // TeslaMate leaves a process open when it restarts mid-charge, so an open
  // one ends at its last reading; a running charge logs one every few seconds.
  return sql<{ from: Date; to: Date }[]>`
    SELECT * FROM (
      SELECT ${utc(sql, 'cp.start_date')} AS from,
             COALESCE(cp.end_date, last.date, cp.start_date) AT TIME ZONE 'UTC' AS to
      FROM charging_processes cp
      LEFT JOIN LATERAL (
        SELECT MAX(date) AS date FROM charges
        WHERE charging_process_id = cp.id AND cp.end_date IS NULL
      ) last ON true
      WHERE cp.car_id = ${carId} AND cp.start_date <= ${at(sql, to)}
    ) spans
    WHERE spans.to >= ${from.toISOString()}::timestamptz
    ORDER BY spans.from
  `;
}

/**
 * Online and asleep periods, drives and software updates overlapping
 * [from, to]. An open state lasts until now; an open drive (left by
 * TeslaMate restarting) ends at its last position.
 */
export function activityIntervals(
  sql: Sql,
  carId: number,
  from: Date,
  to: Date,
): Promise<ActivityInterval[]> {
  return sql<ActivityInterval[]>`
    SELECT * FROM (
      SELECT CASE WHEN s.state = 'online' THEN 'awake' ELSE 'asleep' END AS kind,
             ${utc(sql, 's.start_date')} AS from,
             COALESCE(s.end_date AT TIME ZONE 'UTC', now()) AS to
      FROM states s
      WHERE s.car_id = ${carId} AND s.start_date <= ${at(sql, to)}
      UNION ALL
      SELECT 'driving', ${utc(sql, 'd.start_date')},
             COALESCE(d.end_date, last.date, d.start_date) AT TIME ZONE 'UTC'
      FROM drives d
      LEFT JOIN LATERAL (
        SELECT MAX(date) AS date FROM positions
        WHERE drive_id = d.id AND d.end_date IS NULL
      ) last ON true
      WHERE d.car_id = ${carId} AND d.start_date <= ${at(sql, to)}
      UNION ALL
      SELECT 'updating', ${utc(sql, 'u.start_date')},
             COALESCE(u.end_date AT TIME ZONE 'UTC', now())
      FROM updates u
      WHERE u.car_id = ${carId} AND u.start_date <= ${at(sql, to)}
    ) spans
    WHERE spans.to >= ${from.toISOString()}::timestamptz
  `;
}

export interface LocationRow {
  ts: Date;
  lat: number;
  lon: number;
  speed: number | null;
  elevation: number | null;
  drive_id: number | null;
}

export function locations(
  sql: Sql,
  carId: number,
  from: Date,
  to: Date,
  max: number,
): Promise<LocationRow[]> {
  return sql<LocationRow[]>`
    SELECT ts, lat, lon, speed, elevation, drive_id FROM (
      SELECT ${utc(sql, 'date')} AS ts, latitude::float8 AS lat, longitude::float8 AS lon,
             speed, elevation, drive_id::int AS drive_id,
             ROW_NUMBER() OVER (ORDER BY date) AS rn, COUNT(*) OVER () AS n
      FROM positions
      WHERE car_id = ${carId} AND date BETWEEN ${at(sql, from)} AND ${at(sql, to)}
    ) p
    WHERE rn % CEIL(n / ${max}::float8)::int = 0 OR rn = n OR rn = 1
    ORDER BY ts
  `;
}

/**
 * Drives and charges overlapping [from, to], with the battery level each
 * began and ended at: the time the car wasn't parked and unplugged. Open
 * ones end at their last reading, as `chargeIntervals` explains.
 */
export function busySpans(
  sql: Sql,
  carId: number,
  from: Date,
  to: Date,
): Promise<
  { start: Date; end: Date | null; startLevel: number | null; endLevel: number | null }[]
> {
  return sql`
    SELECT * FROM (
      SELECT ${utc(sql, 'd.start_date')} AS start,
             COALESCE(d.end_date, last.date) AT TIME ZONE 'UTC' AS end,
             sp.battery_level AS "startLevel", ep.battery_level AS "endLevel"
      FROM drives d
      LEFT JOIN positions sp ON sp.id = d.start_position_id
      LEFT JOIN positions ep ON ep.id = d.end_position_id
      LEFT JOIN LATERAL (
        SELECT MAX(date) AS date FROM positions WHERE drive_id = d.id AND d.end_date IS NULL
      ) last ON true
      WHERE d.car_id = ${carId} AND d.start_date <= ${at(sql, to)}
      UNION ALL
      SELECT ${utc(sql, 'cp.start_date')},
             COALESCE(cp.end_date, last.date) AT TIME ZONE 'UTC',
             cp.start_battery_level, cp.end_battery_level
      FROM charging_processes cp
      LEFT JOIN LATERAL (
        SELECT MAX(date) AS date FROM charges
        WHERE charging_process_id = cp.id AND cp.end_date IS NULL
      ) last ON true
      WHERE cp.car_id = ${carId} AND cp.start_date <= ${at(sql, to)}
    ) spans
    WHERE spans.end IS NULL OR spans.end >= ${from.toISOString()}::timestamptz
  `;
}

/** Battery levels from full reports over [from, to], with the last one before `from`. */
export function batteryLevels(
  sql: Sql,
  carId: number,
  from: Date,
  to: Date,
): Promise<{ at: Date; level: number }[]> {
  return sql<{ at: Date; level: number }[]>`
    (SELECT ${utc(sql, 'date')} AS at, battery_level AS level FROM positions
     WHERE car_id = ${carId} AND ideal_battery_range_km IS NOT NULL
       AND battery_level IS NOT NULL AND date < ${at(sql, from)}
     ORDER BY date DESC LIMIT 1)
    UNION ALL
    (SELECT ${utc(sql, 'date')}, battery_level FROM positions
     WHERE car_id = ${carId} AND ideal_battery_range_km IS NOT NULL
       AND battery_level IS NOT NULL AND date BETWEEN ${at(sql, from)} AND ${at(sql, to)}
     ORDER BY date)
    ORDER BY at
  `;
}

export interface DrainRow {
  ts: Date;
  battery_level: number | null;
  odometer: number | null;
  driving: boolean;
}

export function drainRows(sql: Sql, carId: number, since: Date): Promise<DrainRow[]> {
  return sql<DrainRow[]>`
    SELECT ${utc(sql, 'date')} AS ts, battery_level, odometer::float8 AS odometer,
           drive_id IS NOT NULL AS driving
    FROM positions
    WHERE car_id = ${carId} AND ideal_battery_range_km IS NOT NULL AND date >= ${at(sql, since)}
    ORDER BY date
  `;
}

export function tirePressures(
  sql: Sql,
  columns: Columns,
  carId: number,
  since: Date,
  interval: string,
): Promise<
  {
    bucket: Date;
    front_left: number | null;
    front_right: number | null;
    rear_left: number | null;
    rear_right: number | null;
  }[]
> {
  if (!columns.tpms) return Promise.resolve([]);
  return sql`
    SELECT (date_bin(${interval}::interval, date, TIMESTAMP '2020-01-01') AT TIME ZONE 'UTC') AS bucket,
           AVG(tpms_pressure_fl)::float8 AS front_left, AVG(tpms_pressure_fr)::float8 AS front_right,
           AVG(tpms_pressure_rl)::float8 AS rear_left, AVG(tpms_pressure_rr)::float8 AS rear_right
    FROM positions
    WHERE car_id = ${carId} AND ideal_battery_range_km IS NOT NULL AND date >= ${at(sql, since)}
      AND tpms_pressure_fl IS NOT NULL
    GROUP BY 1 ORDER BY 1
  `;
}

/** The last reading of each finished charge that added a meaningful amount. */
export function capacityRows(sql: Sql, carId: number): Promise<CapacityRow[]> {
  return sql<CapacityRow[]>`
    SELECT DISTINCT ON (cp.id) (c.date AT TIME ZONE 'UTC') AS at,
           c.rated_battery_range_km::float8 AS rated_battery_range_km, c.usable_battery_level
    FROM charging_processes cp JOIN charges c ON c.charging_process_id = cp.id
    WHERE cp.car_id = ${carId} AND cp.end_date IS NOT NULL AND cp.charge_energy_added >= 5
      AND c.usable_battery_level > 0
    ORDER BY cp.id, c.date DESC
  `;
}

export function versions(
  sql: Sql,
  carId: number,
): Promise<{ version: string; first_seen: Date }[]> {
  return sql<{ version: string; first_seen: Date }[]>`
    SELECT version, MIN(start_date) AT TIME ZONE 'UTC' AS first_seen FROM updates
    WHERE car_id = ${carId} AND version IS NOT NULL
    GROUP BY version ORDER BY first_seen DESC
  `;
}
