ALTER TABLE "drives" ADD COLUMN "avg_outside_temp_c" real;--> statement-breakpoint
ALTER TABLE "drives" ADD COLUMN "min_outside_temp_c" real;--> statement-breakpoint
ALTER TABLE "drives" ADD COLUMN "max_outside_temp_c" real;--> statement-breakpoint
ALTER TABLE "drives" ADD COLUMN "weather_code" integer;--> statement-breakpoint
ALTER TABLE "drives" ADD COLUMN "wind_kmh" real;--> statement-breakpoint
ALTER TABLE "drives" ADD COLUMN "wind_from_deg" real;--> statement-breakpoint
ALTER TABLE "drives" ADD COLUMN "weather_checked_at" timestamp with time zone;