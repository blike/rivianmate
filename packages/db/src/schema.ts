import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

export const collectorStatus = pgEnum("collector_status", [
  "not_configured",
  "starting",
  "healthy",
  "degraded",
  "reauth_required",
  "rate_limited",
  "offline"
]);

export const confidence = pgEnum("confidence", ["high", "medium", "low"]);

export const localAdminUsers = pgTable("local_admin_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: text("username").notNull().default("admin"),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const localSessions = pgTable(
  "local_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminUserId: uuid("admin_user_id")
      .notNull()
      .references(() => localAdminUsers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    tokenHashIdx: uniqueIndex("local_sessions_token_hash_idx").on(table.tokenHash),
    expiresAtIdx: index("local_sessions_expires_at_idx").on(table.expiresAt)
  })
);

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const rivianCredentials = pgTable("rivian_credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  encryptedAccessToken: text("encrypted_access_token"),
  encryptedRefreshToken: text("encrypted_refresh_token"),
  encryptedUserSessionToken: text("encrypted_user_session_token"),
  status: collectorStatus("status").notNull().default("not_configured"),
  lastRefreshAt: timestamp("last_refresh_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const rivianAuthChallenges = pgTable(
  "rivian_auth_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    csrfToken: text("csrf_token").notNull(),
    appSessionToken: text("app_session_token").notNull(),
    otpToken: text("otp_token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    expiresAtIdx: index("rivian_auth_challenges_expires_at_idx").on(table.expiresAt)
  })
);

export const vehicles = pgTable(
  "vehicles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    rivianVehicleId: text("rivian_vehicle_id").notNull(),
    vin: text("vin"),
    name: text("name").notNull(),
    model: text("model"),
    trim: text("trim"),
    modelYear: integer("model_year"),
    softwareVersion: text("software_version"),
    capabilities: jsonb("capabilities").$type<Record<string, unknown>>(),
    enabled: boolean("enabled").notNull().default(true),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
  },
  (table) => ({
    rivianVehicleIdIdx: uniqueIndex("vehicles_rivian_vehicle_id_idx").on(table.rivianVehicleId),
    accountIdx: index("vehicles_account_idx").on(table.accountId)
  })
);

export const vehicleRawEvents = pgTable(
  "vehicle_raw_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    parserVersion: text("parser_version").notNull(),
    dedupeHash: text("dedupe_hash").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    dedupeIdx: uniqueIndex("vehicle_raw_events_dedupe_idx").on(table.dedupeHash),
    receivedIdx: index("vehicle_raw_events_received_idx").on(table.receivedAt)
  })
);

export const vehicleSnapshots = pgTable(
  "vehicle_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    rawEventId: uuid("raw_event_id").references(() => vehicleRawEvents.id, { onDelete: "set null" }),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    batteryLevel: doublePrecision("battery_level"),
    estimatedRangeKm: doublePrecision("estimated_range_km"),
    chargeLimit: doublePrecision("charge_limit"),
    chargeScheduleTime: text("charge_schedule_time"),
    chargeScheduleType: text("charge_schedule_type"),
    powerState: text("power_state"),
    chargingState: text("charging_state"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    speedMps: doublePrecision("speed_mps"),
    bearing: doublePrecision("bearing"),
    altitudeMeters: doublePrecision("altitude_meters"),
    driveMode: text("drive_mode"),
    cabinTemperatureC: doublePrecision("cabin_temperature_c"),
    outsideTemperatureC: doublePrecision("outside_temperature_c"),
    raw: jsonb("raw").notNull().$type<Record<string, unknown>>()
  },
  (table) => ({
    vehicleObservedIdx: index("vehicle_snapshots_vehicle_observed_idx").on(
      table.vehicleId,
      table.observedAt
    )
  })
);

export const drives = pgTable(
  "drives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    startDate: timestamp("start_date", { withTimezone: true }).notNull(),
    endDate: timestamp("end_date", { withTimezone: true }),
    startLatitude: doublePrecision("start_latitude"),
    startLongitude: doublePrecision("start_longitude"),
    endLatitude: doublePrecision("end_latitude"),
    endLongitude: doublePrecision("end_longitude"),
    startLabel: text("start_label"),
    endLabel: text("end_label"),
    distanceKm: doublePrecision("distance_km"),
    durationSeconds: integer("duration_seconds"),
    startBatteryLevel: doublePrecision("start_battery_level"),
    endBatteryLevel: doublePrecision("end_battery_level"),
    confidence: confidence("confidence").notNull().default("medium"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    vehicleStartIdx: index("drives_vehicle_start_idx").on(table.vehicleId, table.startDate)
  })
);

export const positions = pgTable(
  "positions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    driveId: uuid("drive_id").references(() => drives.id, { onDelete: "set null" }),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    altitudeMeters: doublePrecision("altitude_meters"),
    speedMps: doublePrecision("speed_mps"),
    bearing: doublePrecision("bearing"),
    batteryLevel: doublePrecision("battery_level")
  },
  (table) => ({
    vehicleObservedIdx: index("positions_vehicle_observed_idx").on(table.vehicleId, table.observedAt),
    driveIdx: index("positions_drive_idx").on(table.driveId)
  })
);

export const chargingSessions = pgTable(
  "charging_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    startDate: timestamp("start_date", { withTimezone: true }).notNull(),
    endDate: timestamp("end_date", { withTimezone: true }),
    locationLabel: text("location_label"),
    startBatteryLevel: doublePrecision("start_battery_level"),
    endBatteryLevel: doublePrecision("end_battery_level"),
    energyDeliveredKwh: doublePrecision("energy_delivered_kwh"),
    rangeAddedKm: doublePrecision("range_added_km"),
    peakPowerKw: doublePrecision("peak_power_kw"),
    cost: doublePrecision("cost"),
    currency: text("currency"),
    confidence: confidence("confidence").notNull().default("medium"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    vehicleStartIdx: index("charging_sessions_vehicle_start_idx").on(table.vehicleId, table.startDate)
  })
);

export const chargingSamples = pgTable(
  "charging_samples",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    chargingSessionId: uuid("charging_session_id").references(() => chargingSessions.id, {
      onDelete: "set null"
    }),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    powerKw: doublePrecision("power_kw"),
    totalChargedEnergyKwh: doublePrecision("total_charged_energy_kwh"),
    rangeAddedKm: doublePrecision("range_added_km"),
    cost: doublePrecision("cost"),
    currency: text("currency"),
    raw: jsonb("raw").notNull().$type<Record<string, unknown>>()
  },
  (table) => ({
    vehicleObservedIdx: index("charging_samples_vehicle_observed_idx").on(
      table.vehicleId,
      table.observedAt
    )
  })
);

export const vehicleStates = pgTable(
  "vehicle_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    state: text("state").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    vehicleStartedIdx: index("vehicle_states_vehicle_started_idx").on(table.vehicleId, table.startedAt)
  })
);

export const dataQualityEvents = pgTable(
  "data_quality_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    severity: text("severity").notNull(),
    message: text("message").notNull(),
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    observedIdx: index("data_quality_events_observed_idx").on(table.observedAt)
  })
);
