ALTER TABLE "drives" ADD COLUMN "start_range_km" real;--> statement-breakpoint
ALTER TABLE "drives" ADD COLUMN "end_range_km" real;--> statement-breakpoint
ALTER TABLE "drives" ADD COLUMN "drive_mode" text;--> statement-breakpoint
ALTER TABLE "drives" ADD COLUMN "destination_name" text;--> statement-breakpoint
ALTER TABLE "drives" ADD COLUMN "destination_lat" double precision;--> statement-breakpoint
ALTER TABLE "drives" ADD COLUMN "destination_lon" double precision;