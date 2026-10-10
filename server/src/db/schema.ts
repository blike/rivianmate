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
  text,
  timestamp,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const rivianAccount = pgTable("rivian_account", {
  id: integer("id").primaryKey().default(1),
  email: text("email").notNull(),
  accessTokenEnc: text("access_token_enc").notNull(),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  userSessionTokenEnc: text("user_session_token_enc").notNull(),
  authState: text("auth_state", { enum: ["ok", "unauthenticated"] })
    .notNull()
    .default("ok"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastAuthOkAt: timestamp("last_auth_ok_at", { withTimezone: true }),
});

export const vehicles = pgTable("vehicles", {
  id: text("id").primaryKey(),
  vin: text("vin").notNull().unique(),
  name: text("name"),
  make: text("make"),
  model: text("model"),
  modelYear: integer("model_year"),
  supportedFeatures: jsonb("supported_features").$type<string[]>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const vehicleStateSnapshots = pgTable(
  "vehicle_state_snapshots",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    vehicleId: text("vehicle_id")
      .notNull()
      .references(() => vehicles.id),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    isAnchor: boolean("is_anchor").notNull().default(false),
    batteryLevel: real("battery_level"),
    batteryLimit: real("battery_limit"),
    rangeKm: real("range_km"),
    mileageM: doublePrecision("mileage_m"),
    powerState: text("power_state"),
    chargerStatus: text("charger_status"),
    cabinTemp: real("cabin_temp"),
    data: jsonb("data").notNull(),
  },
  (t) => [index("snapshots_vehicle_ts_idx").on(t.vehicleId, t.ts)],
);

export const drives = pgTable(
  "drives",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    vehicleId: text("vehicle_id")
      .notNull()
      .references(() => vehicles.id),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    startLat: doublePrecision("start_lat"),
    startLon: doublePrecision("start_lon"),
    endLat: doublePrecision("end_lat"),
    endLon: doublePrecision("end_lon"),
    distanceKm: real("distance_km"),
    startMileageM: doublePrecision("start_mileage_m"),
    endMileageM: doublePrecision("end_mileage_m"),
    startBattery: real("start_battery"),
    endBattery: real("end_battery"),
    /** Pack capacity Rivian reported when the drive started. */
    batteryCapacityKwh: real("battery_capacity_kwh"),
    elevationGainM: real("elevation_gain_m"),
    elevationLossM: real("elevation_loss_m"),
    /** Range the vehicle estimated at the start and end. */
    startRangeKm: real("start_range_km"),
    endRangeKm: real("end_range_km"),
    driveMode: text("drive_mode"),
    /** Where the vehicle's navigation was headed, when it was navigating. */
    destinationName: text("destination_name"),
    destinationLat: doublePrecision("destination_lat"),
    destinationLon: doublePrecision("destination_lon"),
    /** Short place names and full addresses for the start and end, looked up after the drive. */
    startPlace: text("start_place"),
    startAddress: text("start_address"),
    endPlace: text("end_place"),
    endAddress: text("end_address"),
    /** When the lookup finished (found or not); null = still to do. */
    placesCheckedAt: timestamp("places_checked_at", { withTimezone: true }),
  },
  (t) => [index("drives_vehicle_started_idx").on(t.vehicleId, t.startedAt)],
);

export const locationPoints = pgTable(
  "location_points",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    vehicleId: text("vehicle_id")
      .notNull()
      .references(() => vehicles.id),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    lat: doublePrecision("lat").notNull(),
    lon: doublePrecision("lon").notNull(),
    speedKmh: real("speed_kmh"),
    bearing: real("bearing"),
    altitude: real("altitude"),
    driveId: bigint("drive_id", { mode: "number" }).references(() => drives.id),
  },
  (t) => [uniqueIndex("locations_vehicle_ts_idx").on(t.vehicleId, t.ts)],
);

export const wallboxes = pgTable("wallboxes", {
  wallboxId: text("wallbox_id").primaryKey(),
  name: text("name"),
  model: text("model"),
  serialNumber: text("serial_number"),
  softwareVersion: text("software_version"),
  maxAmps: real("max_amps"),
  maxVoltage: real("max_voltage"),
  maxPower: real("max_power"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  linked: boolean("linked"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const wallboxReadings = pgTable(
  "wallbox_readings",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    wallboxId: text("wallbox_id")
      .notNull()
      .references(() => wallboxes.wallboxId),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    chargingStatus: text("charging_status"),
    power: real("power"),
    currentVoltage: real("current_voltage"),
    currentAmps: real("current_amps"),
  },
  (t) => [index("wallbox_readings_ts_idx").on(t.wallboxId, t.ts)],
);

export const chargingSessions = pgTable(
  "charging_sessions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    vehicleId: text("vehicle_id")
      .notNull()
      .references(() => vehicles.id),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    chargerId: text("charger_id"),
    chargerType: text("charger_type", {
      enum: ["rivian_charger", "wallbox", "other"],
    }),
    isRivianCharger: boolean("is_rivian_charger"),
    wallboxId: text("wallbox_id").references(() => wallboxes.wallboxId),
    startSoc: real("start_soc"),
    endSoc: real("end_soc"),
    /**
     * A session spans one plug-in (started_at → ended_at). Within it, total
     * time actually charging, and the start of the stretch running now.
     */
    chargingSeconds: integer("charging_seconds"),
    chargingSince: timestamp("charging_since", { withTimezone: true }),
    energyKwh: real("energy_kwh"),
    /** From Rivian's breakdown: energy into the pack vs heating/cooling it. */
    packKwh: real("pack_kwh"),
    thermalKwh: real("thermal_kwh"),
    rangeAddedKm: real("range_added_km"),
    avgPowerKw: real("avg_power_kw"),
    maxPowerKw: real("max_power_kw"),
    cost: numeric("cost", { precision: 10, scale: 2 }),
    /** True once the owner entered the cost; automatic figures never replace it. */
    costEdited: boolean("cost_edited").notNull().default(false),
    currency: text("currency"),
    lat: doublePrecision("lat"),
    lon: doublePrecision("lon"),
    rawFinal: jsonb("raw_final"),
    /** live = recorded by RivianMate; rivian = imported; live+rivian = both. */
    source: text("source", { enum: ["live", "rivian", "live+rivian"] })
      .notNull()
      .default("live"),
    rivianTransactionId: text("rivian_transaction_id"),
    vendor: text("vendor"),
    city: text("city"),
    isPublic: boolean("is_public"),
    isHomeCharger: boolean("is_home_charger"),
  },
  (t) => [
    index("charging_vehicle_started_idx").on(t.vehicleId, t.startedAt),
    uniqueIndex("charging_vehicle_rivian_tx_idx").on(t.vehicleId, t.rivianTransactionId),
  ],
);

/**
 * Observed power/SoC samples per charging session, for the curve chart.
 * Each source keeps its own series; a chart draws one source per session.
 */
export const chargingCurvePoints = pgTable(
  "charging_curve_points",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    sessionId: bigint("session_id", { mode: "number" })
      .notNull()
      .references(() => chargingSessions.id, { onDelete: "cascade" }),
    /**
     * graph = Parallax charging graph; push_chart = the push feed's chart;
     * push_live = the push feed's current reading; forecast = the vehicle's
     * projection to the limit for a charge in progress (replaced by each
     * graph, never a reading); legacy = recorded before sources were kept
     * apart.
     */
    source: text("source", { enum: ["graph", "push_chart", "push_live", "forecast", "legacy"] })
      .notNull()
      .default("legacy"),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    powerKw: real("power_kw"),
    soc: real("soc"),
  },
  (t) => [uniqueIndex("charging_curve_session_source_ts_idx").on(t.sessionId, t.source, t.ts)],
);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/**
 * Rivian's release-notes PDFs, kept per vehicle and software version: Rivian
 * only serves them for the installed and pending versions, via links that
 * expire within the hour.
 */
export const otaReleaseNotes = pgTable(
  "ota_release_notes",
  {
    vehicleId: text("vehicle_id")
      .notNull()
      .references(() => vehicles.id),
    version: text("version").notNull(),
    pdf: bytea("pdf").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.vehicleId, t.version] })],
);

/**
 * The latest Parallax message per vehicle and topic, kept raw (base64
 * protobuf) and decoded when read, so better decoding applies to stored
 * data. A `:awake` suffix keeps the last payload carrying awake-only fields.
 */
export const parallaxLatest = pgTable(
  "parallax_latest",
  {
    vehicleId: text("vehicle_id")
      .notNull()
      .references(() => vehicles.id),
    rvm: text("rvm").notNull(),
    payload: text("payload").notNull(),
    /** Rivian's message timestamp, when given. */
    messageAt: timestamp("message_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.vehicleId, t.rvm] })],
);

/**
 * Every distinct payload of the logged Parallax topics, kept for 30 days so
 * undocumented fields can be decoded against how they change.
 */
export const parallaxMessages = pgTable(
  "parallax_messages",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    vehicleId: text("vehicle_id")
      .notNull()
      .references(() => vehicles.id),
    rvm: text("rvm").notNull(),
    payload: text("payload").notNull(),
    messageAt: timestamp("message_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("parallax_messages_vehicle_rvm_idx").on(t.vehicleId, t.rvm, t.receivedAt),
    index("parallax_messages_received_idx").on(t.receivedAt),
  ],
);

/**
 * Reverse-geocoding results by rounded coordinates (~11 m), so a place is
 * looked up once. A null place means nothing was found there.
 */
export const geocodeCache = pgTable("geocode_cache", {
  key: text("key").primaryKey(),
  place: text("place"),
  address: text("address"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});
