import {
  customType,
  bigint,
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  primaryKey,
  serial,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { ImportCounts } from '../api-types.js';
import type { VehicleDetails, VehicleImageUrls } from '../rivian/types.js';

/** Only imported rows are indexed: nearly all of these tables is live data. */
const importedIndex = (name: string, column: AnyPgColumn) =>
  index(name)
    .on(column)
    .where(sql`${column} IS NOT NULL`);

export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const rivianAccount = pgTable('rivian_account', {
  id: integer('id').primaryKey().default(1),
  email: text('email').notNull(),
  accessTokenEnc: text('access_token_enc').notNull(),
  refreshTokenEnc: text('refresh_token_enc').notNull(),
  userSessionTokenEnc: text('user_session_token_enc').notNull(),
  authState: text('auth_state', { enum: ['ok', 'unauthenticated'] })
    .notNull()
    .default('ok'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  lastAuthOkAt: timestamp('last_auth_ok_at', { withTimezone: true }),
});

export const vehicles = pgTable('vehicles', {
  id: text('id').primaryKey(),
  /** Short key for the vehicle in the high-volume history tables. */
  seq: smallint('seq').generatedAlwaysAsIdentity().notNull().unique(),
  vin: text('vin').notNull().unique(),
  name: text('name'),
  make: text('make'),
  model: text('model'),
  modelYear: integer('model_year'),
  supportedFeatures: jsonb('supported_features').$type<string[]>(),
  details: jsonb('details').$type<VehicleDetails>(),
  images: jsonb('images').$type<VehicleImageUrls>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A run of the ElectraFi import, so everything it added can be told apart and
 * removed. Rows point here by `import_id`; a plain column, as a foreign key
 * would make adding it scan the history tables.
 */
export const importBatches = pgTable('import_batches', {
  id: serial('id').primaryKey(),
  vehicleId: text('vehicle_id')
    .notNull()
    .references(() => vehicles.id),
  files: jsonb('files').$type<string[]>().notNull(),
  timeZone: text('time_zone').notNull(),
  /** The dates chosen, in `time_zone`, both included. */
  fromDate: text('from_date').notNull(),
  toDate: text('to_date').notNull(),
  status: text('status', { enum: ['running', 'done', 'failed'] })
    .notNull()
    .default('running'),
  counts: jsonb('counts').$type<ImportCounts>(),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});

export const drives = pgTable(
  'drives',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    vehicleId: text('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    startLat: doublePrecision('start_lat'),
    startLon: doublePrecision('start_lon'),
    endLat: doublePrecision('end_lat'),
    endLon: doublePrecision('end_lon'),
    distanceKm: real('distance_km'),
    startMileageM: doublePrecision('start_mileage_m'),
    endMileageM: doublePrecision('end_mileage_m'),
    startBattery: real('start_battery'),
    endBattery: real('end_battery'),
    /** Pack capacity Rivian reported when the drive started. */
    batteryCapacityKwh: real('battery_capacity_kwh'),
    elevationGainM: real('elevation_gain_m'),
    elevationLossM: real('elevation_loss_m'),
    /** Range the vehicle estimated at the start and end. */
    startRangeKm: real('start_range_km'),
    endRangeKm: real('end_range_km'),
    driveMode: text('drive_mode'),
    /** Where the vehicle's navigation was headed, when it was navigating. */
    destinationName: text('destination_name'),
    destinationLat: doublePrecision('destination_lat'),
    destinationLon: doublePrecision('destination_lon'),
    /** Short place names and full addresses for the start and end, looked up after the drive. */
    startPlace: text('start_place'),
    startAddress: text('start_address'),
    endPlace: text('end_place'),
    endAddress: text('end_address'),
    /** When the lookup finished (found or not); null = still to do. */
    placesCheckedAt: timestamp('places_checked_at', { withTimezone: true }),
    /**
     * The weather along the route, from weather model data every few minutes
     * of it, looked up once the drive ends. Temperatures in °C: time-weighted
     * average, low, and high.
     */
    avgOutsideTempC: real('avg_outside_temp_c'),
    minOutsideTempC: real('min_outside_temp_c'),
    maxOutsideTempC: real('max_outside_temp_c'),
    /** WMO code for the drive's conditions: the commonest, unless it was wet for a good part of it. */
    weatherCode: integer('weather_code'),
    /** Average wind at 10 m (km/h), and where it mostly blew from (degrees), weighted by speed. */
    windKmh: real('wind_kmh'),
    windFromDeg: real('wind_from_deg'),
    /** When the weather lookup finished (found or not); null = still to do. */
    weatherCheckedAt: timestamp('weather_checked_at', { withTimezone: true }),
    importId: integer('import_id'),
  },
  (t) => [
    index('drives_vehicle_started_idx').on(t.vehicleId, t.startedAt),
    importedIndex('drives_import_idx', t.importId),
  ],
);

export const locationPoints = pgTable(
  'location_points',
  {
    vehicleId: text('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    ts: timestamp('ts', { withTimezone: true }).notNull(),
    lat: doublePrecision('lat').notNull(),
    lon: doublePrecision('lon').notNull(),
    speedKmh: real('speed_kmh'),
    bearing: real('bearing'),
    altitude: real('altitude'),
    driveId: bigint('drive_id', { mode: 'number' }).references(() => drives.id),
    importId: integer('import_id'),
  },
  (t) => [
    primaryKey({ columns: [t.vehicleId, t.ts] }),
    index('location_points_drive_ts_idx').on(t.driveId, t.ts),
    importedIndex('location_points_import_idx', t.importId),
  ],
);

export const wallboxes = pgTable('wallboxes', {
  wallboxId: text('wallbox_id').primaryKey(),
  name: text('name'),
  model: text('model'),
  serialNumber: text('serial_number'),
  softwareVersion: text('software_version'),
  maxAmps: real('max_amps'),
  maxVoltage: real('max_voltage'),
  maxPower: real('max_power'),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
  linked: boolean('linked'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const wallboxReadings = pgTable(
  'wallbox_readings',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    wallboxId: text('wallbox_id')
      .notNull()
      .references(() => wallboxes.wallboxId),
    ts: timestamp('ts', { withTimezone: true }).notNull(),
    chargingStatus: text('charging_status'),
    power: real('power'),
    currentVoltage: real('current_voltage'),
    currentAmps: real('current_amps'),
  },
  (t) => [index('wallbox_readings_ts_idx').on(t.wallboxId, t.ts)],
);

export const chargingSessions = pgTable(
  'charging_sessions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    vehicleId: text('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    chargerId: text('charger_id'),
    chargerType: text('charger_type', {
      enum: ['rivian_charger', 'wallbox', 'other'],
    }),
    isRivianCharger: boolean('is_rivian_charger'),
    wallboxId: text('wallbox_id').references(() => wallboxes.wallboxId),
    startSoc: real('start_soc'),
    endSoc: real('end_soc'),
    /**
     * A session spans one plug-in (started_at → ended_at). Within it, total
     * time actually charging, and the start of the stretch running now.
     */
    chargingSeconds: integer('charging_seconds'),
    chargingSince: timestamp('charging_since', { withTimezone: true }),
    energyKwh: real('energy_kwh'),
    /** From Rivian's breakdown: energy into the pack vs heating/cooling it. */
    packKwh: real('pack_kwh'),
    thermalKwh: real('thermal_kwh'),
    rangeAddedKm: real('range_added_km'),
    avgPowerKw: real('avg_power_kw'),
    maxPowerKw: real('max_power_kw'),
    cost: numeric('cost', { precision: 10, scale: 2 }),
    /** True once the owner entered the cost; automatic figures never replace it. */
    costEdited: boolean('cost_edited').notNull().default(false),
    currency: text('currency'),
    lat: doublePrecision('lat'),
    lon: doublePrecision('lon'),
    rawFinal: jsonb('raw_final'),
    /** live = recorded by RivianMate; rivian = imported; live+rivian = both; electrafi = from an ElectraFi export. */
    source: text('source', { enum: ['live', 'rivian', 'live+rivian', 'electrafi'] })
      .notNull()
      .default('live'),
    rivianTransactionId: text('rivian_transaction_id'),
    vendor: text('vendor'),
    city: text('city'),
    isPublic: boolean('is_public'),
    isHomeCharger: boolean('is_home_charger'),
    /** When an imported session's city was looked up (found or not); null = still to do. */
    placesCheckedAt: timestamp('places_checked_at', { withTimezone: true }),
    importId: integer('import_id'),
  },
  (t) => [
    index('charging_vehicle_started_idx').on(t.vehicleId, t.startedAt),
    uniqueIndex('charging_vehicle_rivian_tx_idx').on(t.vehicleId, t.rivianTransactionId),
    importedIndex('charging_sessions_import_idx', t.importId),
  ],
);

/**
 * Observed power/SoC samples per charging session, for the curve chart.
 * Each source keeps its own series; a chart draws one source per session.
 */
export const chargingCurvePoints = pgTable(
  'charging_curve_points',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sessionId: bigint('session_id', { mode: 'number' })
      .notNull()
      .references(() => chargingSessions.id, { onDelete: 'cascade' }),
    /**
     * observed = the app's own sample a minute while charging, from the
     * live readings; graph = Parallax charging graph; push_chart = the push
     * feed's chart;
     * push_live = the push feed's current reading; forecast = the vehicle's
     * projection to the limit for a charge in progress (replaced by each
     * graph, never a reading); electrafi = from an ElectraFi export; legacy =
     * recorded before sources were kept apart.
     */
    source: text('source', {
      enum: ['observed', 'graph', 'push_chart', 'push_live', 'forecast', 'electrafi', 'legacy'],
    })
      .notNull()
      .default('legacy'),
    ts: timestamp('ts', { withTimezone: true }).notNull(),
    powerKw: real('power_kw'),
    soc: real('soc'),
    importId: integer('import_id'),
  },
  (t) => [
    uniqueIndex('charging_curve_session_source_ts_idx').on(t.sessionId, t.source, t.ts),
    importedIndex('charging_curve_points_import_idx', t.importId),
  ],
);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/**
 * Rivian's release-notes PDFs, kept per vehicle and software version: Rivian
 * only serves them for the installed and pending versions, via links that
 * expire within the hour.
 */
export const otaReleaseNotes = pgTable(
  'ota_release_notes',
  {
    vehicleId: text('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    version: text('version').notNull(),
    pdf: bytea('pdf').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.vehicleId, t.version] })],
);

/**
 * The latest Parallax message per vehicle and topic, kept raw (base64
 * protobuf) and decoded when read, so better decoding applies to stored
 * data. A `:awake` suffix keeps the last payload carrying awake-only fields.
 */
export const parallaxLatest = pgTable(
  'parallax_latest',
  {
    vehicleId: text('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    rvm: text('rvm').notNull(),
    payload: text('payload').notNull(),
    /** Rivian's message timestamp, when given. */
    messageAt: timestamp('message_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.vehicleId, t.rvm] })],
);

/**
 * Reverse-geocoding results by rounded coordinates (~11 m), so a place is
 * looked up once. A null place means nothing was found there.
 */
export const geocodeCache = pgTable('geocode_cache', {
  key: text('key').primaryKey(),
  place: text('place'),
  address: text('address'),
  /** Town and state, e.g. "Austin, TX"; null on results from before it was kept. */
  area: text('area'),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Places the user named (Home, Work…), each an area around a point. Drives
 * and charging sessions inside one take its name, and sessions its rate.
 */
export const savedLocations = pgTable('saved_locations', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  name: text('name').notNull(),
  lat: doublePrecision('lat').notNull(),
  lon: doublePrecision('lon').notNull(),
  radiusM: integer('radius_m').notNull().default(150),
  /** Counts as home for "only when not at home" alerts and home charging. */
  isHome: boolean('is_home').notNull().default(false),
  /** Price per kWh here; null = no estimate, 0 = free. */
  ratePerKwh: real('rate_per_kwh'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Names of the vehicle state fields recorded in state_changes. */
export const stateFields = pgTable('state_fields', {
  id: smallint('id').primaryKey().generatedAlwaysAsIdentity(),
  name: text('name').notNull().unique(),
});

/**
 * Vehicle state history: each change of a field's value, at Rivian's time
 * for it, from whichever feed the app used. A field holds its value until
 * its next row. Numbers go in `num`, anything else in `value`; neither
 * means Rivian reported no value.
 */
export const stateChanges = pgTable(
  'state_changes',
  {
    vehicleSeq: smallint('vehicle_seq')
      .notNull()
      .references(() => vehicles.seq),
    fieldId: smallint('field_id')
      .notNull()
      .references(() => stateFields.id),
    at: timestamp('at', { withTimezone: true }).notNull(),
    num: doublePrecision('num'),
    value: text('value'),
    importId: integer('import_id'),
  },
  (t) => [
    primaryKey({ columns: [t.vehicleSeq, t.fieldId, t.at] }),
    importedIndex('state_changes_import_idx', t.importId),
  ],
);

/**
 * When state was being received for a vehicle, at most every 15 minutes,
 * so history can tell a value that held from a stretch nothing was heard.
 */
export const stateHeartbeats = pgTable(
  'state_heartbeats',
  {
    vehicleSeq: smallint('vehicle_seq')
      .notNull()
      .references(() => vehicles.seq),
    at: timestamp('at', { withTimezone: true }).notNull(),
    importId: integer('import_id'),
  },
  (t) => [
    primaryKey({ columns: [t.vehicleSeq, t.at] }),
    importedIndex('state_heartbeats_import_idx', t.importId),
  ],
);

/** Names of the Parallax topics in the archive. */
export const parallaxTopics = pgTable('parallax_topics', {
  id: smallint('id').primaryKey().generatedAlwaysAsIdentity(),
  rvm: text('rvm').notNull().unique(),
});

/**
 * Every distinct Parallax payload of every topic, raw, kept for good so
 * better decoding applies to all of it. Recent ones are a row each; older
 * ones are packed into parallax_chunks.
 */
export const parallaxArchive = pgTable(
  'parallax_archive',
  {
    vehicleSeq: smallint('vehicle_seq')
      .notNull()
      .references(() => vehicles.seq),
    topicId: smallint('topic_id')
      .notNull()
      .references(() => parallaxTopics.id),
    /** Rivian's message time, or when it arrived if it had none. Not unique: Rivian may stamp in seconds. */
    at: timestamp('at', { withTimezone: true }).notNull(),
    payload: bytea('payload').notNull(),
  },
  (t) => [index('parallax_archive_vehicle_topic_at_idx').on(t.vehicleSeq, t.topicId, t.at)],
);

/** One hour of a topic's archived payloads, compressed together (see parallax-archive.ts). */
export const parallaxChunks = pgTable(
  'parallax_chunks',
  {
    vehicleSeq: smallint('vehicle_seq')
      .notNull()
      .references(() => vehicles.seq),
    topicId: smallint('topic_id')
      .notNull()
      .references(() => parallaxTopics.id),
    hour: timestamp('hour', { withTimezone: true }).notNull(),
    count: integer('count').notNull(),
    data: bytea('data').notNull(),
  },
  (t) => [primaryKey({ columns: [t.vehicleSeq, t.topicId, t.hour] })],
);
