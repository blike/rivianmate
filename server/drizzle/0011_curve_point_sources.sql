DROP INDEX "charging_curve_session_ts_idx";--> statement-breakpoint
ALTER TABLE "charging_curve_points" ADD COLUMN "source" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "charging_curve_session_source_ts_idx" ON "charging_curve_points" USING btree ("session_id","source","ts");