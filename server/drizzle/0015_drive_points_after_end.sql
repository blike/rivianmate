-- Points recorded while a drive waited out its park grace were attached to it.
UPDATE "location_points" AS p
SET "drive_id" = NULL
FROM "drives" AS d
WHERE p."drive_id" = d."id"
  AND d."ended_at" IS NOT NULL
  AND p."ts" > d."ended_at";
