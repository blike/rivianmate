CREATE TABLE "geocode_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"place" text,
	"address" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "drives" ADD COLUMN "start_place" text;--> statement-breakpoint
ALTER TABLE "drives" ADD COLUMN "start_address" text;--> statement-breakpoint
ALTER TABLE "drives" ADD COLUMN "end_place" text;--> statement-breakpoint
ALTER TABLE "drives" ADD COLUMN "end_address" text;--> statement-breakpoint
ALTER TABLE "drives" ADD COLUMN "places_checked_at" timestamp with time zone;