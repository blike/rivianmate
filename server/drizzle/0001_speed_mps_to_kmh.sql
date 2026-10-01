-- gnssSpeed is reported in m/s but was stored as-is in speed_kmh. Every row
-- written before this migration holds m/s, so convert them once.
UPDATE "location_points" SET "speed_kmh" = "speed_kmh" * 3.6 WHERE "speed_kmh" IS NOT NULL;
