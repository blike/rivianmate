CREATE TABLE "ota_release_notes" (
	"vehicle_id" text NOT NULL,
	"version" text NOT NULL,
	"url" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ota_release_notes_vehicle_id_version_pk" PRIMARY KEY("vehicle_id","version")
);
--> statement-breakpoint
ALTER TABLE "ota_release_notes" ADD CONSTRAINT "ota_release_notes_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;