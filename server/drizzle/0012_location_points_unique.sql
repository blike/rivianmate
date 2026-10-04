-- A restart forgot the last point it stored and stored Rivian's last fix
-- again. Keep one row per vehicle and time (one with a drive, if any)
-- before making them unique.
DELETE FROM "location_points" a USING "location_points" b
WHERE a."vehicle_id" = b."vehicle_id" AND a."ts" = b."ts" AND (
  (a."drive_id" IS NULL AND b."drive_id" IS NOT NULL) OR
  ((a."drive_id" IS NULL) = (b."drive_id" IS NULL) AND a."id" > b."id")
);--> statement-breakpoint
DROP INDEX "locations_vehicle_ts_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "locations_vehicle_ts_idx" ON "location_points" USING btree ("vehicle_id","ts");
