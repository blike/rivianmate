ALTER TABLE "charging_sessions" ADD COLUMN "source" text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD COLUMN "rivian_transaction_id" text;--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD COLUMN "vendor" text;--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD COLUMN "is_public" boolean;--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD COLUMN "is_home_charger" boolean;--> statement-breakpoint
CREATE UNIQUE INDEX "charging_vehicle_rivian_tx_idx" ON "charging_sessions" USING btree ("vehicle_id","rivian_transaction_id");