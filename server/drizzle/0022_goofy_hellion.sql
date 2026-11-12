CREATE TABLE "parked_energy_nights" (
	"vehicle_id" text NOT NULL,
	"day" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"minutes" integer NOT NULL,
	"kwh" real NOT NULL,
	"range_km" real NOT NULL,
	"climate_kwh" real NOT NULL,
	"system_kwh" real NOT NULL,
	"gear_guard_kwh" real NOT NULL,
	"outlets_kwh" real NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parked_energy_nights_vehicle_id_day_pk" PRIMARY KEY("vehicle_id","day")
);
--> statement-breakpoint
ALTER TABLE "parked_energy_nights" ADD CONSTRAINT "parked_energy_nights_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;