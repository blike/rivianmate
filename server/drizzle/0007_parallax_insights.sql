CREATE TABLE "parallax_latest" (
	"vehicle_id" text NOT NULL,
	"rvm" text NOT NULL,
	"payload" text NOT NULL,
	"message_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parallax_latest_vehicle_id_rvm_pk" PRIMARY KEY("vehicle_id","rvm")
);
--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD COLUMN "pack_kwh" real;--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD COLUMN "thermal_kwh" real;--> statement-breakpoint
ALTER TABLE "parallax_latest" ADD CONSTRAINT "parallax_latest_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;