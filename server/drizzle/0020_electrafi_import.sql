CREATE TABLE "import_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"vehicle_id" text NOT NULL,
	"format" text NOT NULL,
	"files" jsonb NOT NULL,
	"time_zone" text NOT NULL,
	"from_date" text NOT NULL,
	"to_date" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"counts" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "import_session_fills" (
	"import_id" integer NOT NULL,
	"session_id" bigint NOT NULL,
	"fields" jsonb NOT NULL,
	CONSTRAINT "import_session_fills_import_id_session_id_pk" PRIMARY KEY("import_id","session_id")
);
--> statement-breakpoint
ALTER TABLE "charging_curve_points" ADD COLUMN "import_id" integer;--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD COLUMN "places_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD COLUMN "import_id" integer;--> statement-breakpoint
ALTER TABLE "drives" ADD COLUMN "import_id" integer;--> statement-breakpoint
ALTER TABLE "geocode_cache" ADD COLUMN "area" text;--> statement-breakpoint
ALTER TABLE "location_points" ADD COLUMN "import_id" integer;--> statement-breakpoint
ALTER TABLE "state_changes" ADD COLUMN "import_id" integer;--> statement-breakpoint
ALTER TABLE "state_heartbeats" ADD COLUMN "import_id" integer;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_session_fills" ADD CONSTRAINT "import_session_fills_import_id_import_batches_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_session_fills" ADD CONSTRAINT "import_session_fills_session_id_charging_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."charging_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "charging_curve_points_import_idx" ON "charging_curve_points" USING btree ("import_id") WHERE "charging_curve_points"."import_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "location_points_import_idx" ON "location_points" USING btree ("import_id") WHERE "location_points"."import_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "state_changes_import_idx" ON "state_changes" USING btree ("import_id") WHERE "state_changes"."import_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "state_heartbeats_import_idx" ON "state_heartbeats" USING btree ("import_id") WHERE "state_heartbeats"."import_id" IS NOT NULL;