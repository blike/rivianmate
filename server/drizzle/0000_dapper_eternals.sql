CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "charging_sessions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"vehicle_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"charger_id" text,
	"charger_type" text,
	"is_rivian_charger" boolean,
	"wallbox_id" text,
	"start_soc" real,
	"end_soc" real,
	"energy_kwh" real,
	"range_added_km" real,
	"avg_power_kw" real,
	"max_power_kw" real,
	"cost" numeric(10, 2),
	"currency" text,
	"lat" double precision,
	"lon" double precision,
	"raw_final" jsonb
);
--> statement-breakpoint
CREATE TABLE "drives" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"vehicle_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"start_lat" double precision,
	"start_lon" double precision,
	"end_lat" double precision,
	"end_lon" double precision,
	"distance_km" real,
	"start_mileage_m" double precision,
	"end_mileage_m" double precision,
	"start_battery" real,
	"end_battery" real
);
--> statement-breakpoint
CREATE TABLE "location_points" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"vehicle_id" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"speed_kmh" real,
	"bearing" real,
	"altitude" real,
	"drive_id" bigint
);
--> statement-breakpoint
CREATE TABLE "rivian_account" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"email" text NOT NULL,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"user_session_token_enc" text NOT NULL,
	"auth_state" text DEFAULT 'ok' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_auth_ok_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "vehicle_state_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"vehicle_id" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"is_anchor" boolean DEFAULT false NOT NULL,
	"battery_level" real,
	"battery_limit" real,
	"range_km" real,
	"mileage_m" double precision,
	"power_state" text,
	"charger_status" text,
	"cabin_temp" real,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" text PRIMARY KEY NOT NULL,
	"vin" text NOT NULL,
	"name" text,
	"make" text,
	"model" text,
	"model_year" integer,
	"supported_features" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_vin_unique" UNIQUE("vin")
);
--> statement-breakpoint
CREATE TABLE "wallbox_readings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"wallbox_id" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"charging_status" text,
	"power" real,
	"current_voltage" real,
	"current_amps" real
);
--> statement-breakpoint
CREATE TABLE "wallboxes" (
	"wallbox_id" text PRIMARY KEY NOT NULL,
	"name" text,
	"model" text,
	"serial_number" text,
	"software_version" text,
	"max_amps" real,
	"max_voltage" real,
	"max_power" real,
	"latitude" double precision,
	"longitude" double precision,
	"linked" boolean,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD CONSTRAINT "charging_sessions_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD CONSTRAINT "charging_sessions_wallbox_id_wallboxes_wallbox_id_fk" FOREIGN KEY ("wallbox_id") REFERENCES "public"."wallboxes"("wallbox_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drives" ADD CONSTRAINT "drives_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_points" ADD CONSTRAINT "location_points_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_points" ADD CONSTRAINT "location_points_drive_id_drives_id_fk" FOREIGN KEY ("drive_id") REFERENCES "public"."drives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_state_snapshots" ADD CONSTRAINT "vehicle_state_snapshots_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallbox_readings" ADD CONSTRAINT "wallbox_readings_wallbox_id_wallboxes_wallbox_id_fk" FOREIGN KEY ("wallbox_id") REFERENCES "public"."wallboxes"("wallbox_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "charging_vehicle_started_idx" ON "charging_sessions" USING btree ("vehicle_id","started_at");--> statement-breakpoint
CREATE INDEX "drives_vehicle_started_idx" ON "drives" USING btree ("vehicle_id","started_at");--> statement-breakpoint
CREATE INDEX "locations_vehicle_ts_idx" ON "location_points" USING btree ("vehicle_id","ts");--> statement-breakpoint
CREATE INDEX "snapshots_vehicle_ts_idx" ON "vehicle_state_snapshots" USING btree ("vehicle_id","ts");--> statement-breakpoint
CREATE INDEX "wallbox_readings_ts_idx" ON "wallbox_readings" USING btree ("wallbox_id","ts");