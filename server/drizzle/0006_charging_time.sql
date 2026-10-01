ALTER TABLE "charging_sessions" ADD COLUMN "charging_seconds" integer;--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD COLUMN "charging_since" timestamp with time zone;