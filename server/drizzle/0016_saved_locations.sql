CREATE TABLE "saved_locations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"radius_m" integer DEFAULT 150 NOT NULL,
	"is_home" boolean DEFAULT false NOT NULL,
	"rate_per_kwh" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- The single home location becomes a saved location named Home, with the
-- home rate. Without one, a rate was used at the Wall Charger: put Home there.
INSERT INTO "saved_locations" ("name", "lat", "lon", "is_home", "rate_per_kwh")
SELECT 'Home', h."lat", h."lon", true, h."rate"
FROM (
  SELECT
    coalesce(("value"::jsonb->>'homeLat')::double precision, w."latitude") AS "lat",
    coalesce(("value"::jsonb->>'homeLon')::double precision, w."longitude") AS "lon",
    ("value"::jsonb->>'homeLat') IS NOT NULL AS "has_home",
    ("value"::jsonb->>'ratePerKwh')::real AS "rate"
  FROM "app_settings"
  LEFT JOIN LATERAL (
    SELECT "latitude", "longitude" FROM "wallboxes"
    WHERE "latitude" IS NOT NULL AND "longitude" IS NOT NULL
    ORDER BY "wallbox_id" LIMIT 1
  ) AS w ON true
  WHERE "key" = 'home_charging'
) AS h
WHERE h."lat" IS NOT NULL AND h."lon" IS NOT NULL AND (h."has_home" OR h."rate" IS NOT NULL);
