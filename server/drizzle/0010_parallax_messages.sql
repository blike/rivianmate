CREATE TABLE "parallax_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"vehicle_id" text NOT NULL,
	"rvm" text NOT NULL,
	"payload" text NOT NULL,
	"message_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "parallax_messages" ADD CONSTRAINT "parallax_messages_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "parallax_messages_vehicle_rvm_idx" ON "parallax_messages" USING btree ("vehicle_id","rvm","received_at");--> statement-breakpoint
CREATE INDEX "parallax_messages_received_idx" ON "parallax_messages" USING btree ("received_at");