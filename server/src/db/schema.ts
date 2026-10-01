import {
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
  (t) => [index("locations_vehicle_ts_idx").on(t.vehicleId, t.ts)],
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
    energyKwh: real("energy_kwh"),
    rangeAddedKm: real("range_added_km"),
    avgPowerKw: real("avg_power_kw"),
    maxPowerKw: real("max_power_kw"),
    cost: numeric("cost", { precision: 10, scale: 2 }),
    currency: text("currency"),
    lat: doublePrecision("lat"),
    lon: doublePrecision("lon"),
    rawFinal: jsonb("raw_final"),
  },
  (t) => [
    index("charging_vehicle_started_idx").on(t.vehicleId, t.startedAt),
  ],
);

/** Observed power/SoC samples per charging session, for the curve chart. */
export const chargingCurvePoints = pgTable(
  "charging_curve_points",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    sessionId: bigint("session_id", { mode: "number" })
      .notNull()
      .references(() => chargingSessions.id, { onDelete: "cascade" }),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    powerKw: real("power_kw"),
    soc: real("soc"),
  },
  (t) => [uniqueIndex("charging_curve_session_ts_idx").on(t.sessionId, t.ts)],
);

/** Release-notes links Rivian returned, per vehicle and software version. */
export const otaReleaseNotes = pgTable(
  "ota_release_notes",
  {
    vehicleId: text("vehicle_id")
      .notNull()
      .references(() => vehicles.id),
    version: text("version").notNull(),
    url: text("url").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.vehicleId, t.version] })],
);
