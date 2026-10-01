CREATE TABLE "charging_curve_points" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"session_id" bigint NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"power_kw" real,
	"soc" real
);
--> statement-breakpoint
ALTER TABLE "charging_curve_points" ADD CONSTRAINT "charging_curve_points_session_id_charging_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."charging_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "charging_curve_session_ts_idx" ON "charging_curve_points" USING btree ("session_id","ts");