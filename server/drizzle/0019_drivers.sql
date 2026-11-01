CREATE TABLE "drivers" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"vehicle_id" text NOT NULL,
	"profile_id" text,
	"name" text,
	"reported_name" text,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "drives" ADD COLUMN "driver_id" bigint;--> statement-breakpoint
ALTER TABLE "drives" ADD COLUMN "driver_source" text;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "drivers_vehicle_profile_idx" ON "drivers" USING btree ("vehicle_id","profile_id");--> statement-breakpoint
ALTER TABLE "drives" ADD CONSTRAINT "drives_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "drives_driver_started_idx" ON "drives" USING btree ("driver_id","started_at");