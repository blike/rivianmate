-- GPS speed noise while parked held some drives open until the vehicle
-- slept. End those when they shifted to park: the first park after their
-- last shift into drive or reverse, if that's at most 10 minutes earlier.
WITH "ends" AS (
  SELECT d."id", d."ended_at", parked."at" AS "parked_at"
  FROM "drives" AS d
  CROSS JOIN LATERAL (
    SELECT max(("data"->'gearStatus'->>'timeStamp')::timestamptz) AS "at"
    FROM "vehicle_state_snapshots"
    WHERE "vehicle_id" = d."vehicle_id"
      AND "ts" BETWEEN d."started_at" AND d."ended_at" + interval '15 minutes'
      AND "data"->'gearStatus'->>'value' IN ('drive', 'reverse')
      AND ("data"->'gearStatus'->>'timeStamp')::timestamptz <= d."ended_at"
  ) AS moved
  CROSS JOIN LATERAL (
    SELECT min(("data"->'gearStatus'->>'timeStamp')::timestamptz) AS "at"
    FROM "vehicle_state_snapshots"
    WHERE "vehicle_id" = d."vehicle_id"
      AND "ts" BETWEEN moved."at" AND d."ended_at" + interval '15 minutes'
      AND "data"->'gearStatus'->>'value' = 'park'
      AND ("data"->'gearStatus'->>'timeStamp')::timestamptz > moved."at"
  ) AS parked
  WHERE d."ended_at" IS NOT NULL
)
UPDATE "drives" AS d
SET "ended_at" = e."parked_at"
FROM "ends" AS e
WHERE d."id" = e."id"
  AND e."parked_at" < e."ended_at"
  AND e."ended_at" - e."parked_at" <= interval '10 minutes';
--> statement-breakpoint
-- Points recorded after a drive ended (while it waited out the park grace,
-- or stayed open as above) belong to no drive.
UPDATE "location_points" AS p
SET "drive_id" = NULL
FROM "drives" AS d
WHERE p."drive_id" = d."id"
  AND d."ended_at" IS NOT NULL
  AND p."ts" > d."ended_at";
