CREATE TABLE "trip_activities" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"trip_id" bigint NOT NULL,
	"vehicle_id" text NOT NULL,
	"kind" text NOT NULL,
	"activity_id" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_exclusions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"trip_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"activity_id" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"vehicle_id" text NOT NULL,
	"name" text NOT NULL,
	"notes" text,
	"start_date" text,
	"end_date" text,
	"time_zone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trip_activities" ADD CONSTRAINT "trip_activities_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_exclusions" ADD CONSTRAINT "trip_exclusions_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trip_activities_activity_idx" ON "trip_activities" USING btree ("vehicle_id","kind","activity_id");--> statement-breakpoint
CREATE INDEX "trip_activities_trip_idx" ON "trip_activities" USING btree ("trip_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_exclusions_activity_idx" ON "trip_exclusions" USING btree ("trip_id","kind","activity_id");--> statement-breakpoint
CREATE INDEX "trips_vehicle_idx" ON "trips" USING btree ("vehicle_id");