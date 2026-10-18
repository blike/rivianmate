CREATE TABLE "parallax_archive" (
	"vehicle_seq" smallint NOT NULL,
	"topic_id" smallint NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"payload" "bytea" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parallax_chunks" (
	"vehicle_seq" smallint NOT NULL,
	"topic_id" smallint NOT NULL,
	"hour" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	"data" "bytea" NOT NULL,
	CONSTRAINT "parallax_chunks_vehicle_seq_topic_id_hour_pk" PRIMARY KEY("vehicle_seq","topic_id","hour")
);
--> statement-breakpoint
CREATE TABLE "parallax_topics" (
	"id" smallint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "parallax_topics_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 32767 START WITH 1 CACHE 1),
	"rvm" text NOT NULL,
	CONSTRAINT "parallax_topics_rvm_unique" UNIQUE("rvm")
);
--> statement-breakpoint
CREATE TABLE "state_changes" (
	"vehicle_seq" smallint NOT NULL,
	"field_id" smallint NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"num" double precision,
	"value" text,
	CONSTRAINT "state_changes_vehicle_seq_field_id_at_pk" PRIMARY KEY("vehicle_seq","field_id","at")
);
--> statement-breakpoint
CREATE TABLE "state_fields" (
	"id" smallint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "state_fields_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 32767 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	CONSTRAINT "state_fields_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "state_heartbeats" (
	"vehicle_seq" smallint NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "state_heartbeats_vehicle_seq_at_pk" PRIMARY KEY("vehicle_seq","at")
);
--> statement-breakpoint
DROP INDEX "locations_vehicle_ts_idx";--> statement-breakpoint
ALTER TABLE "location_points" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "location_points" ADD CONSTRAINT "location_points_vehicle_id_ts_pk" PRIMARY KEY("vehicle_id","ts");--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "seq" smallint NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "vehicles_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 32767 START WITH 1 CACHE 1);--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_seq_unique" UNIQUE("seq");--> statement-breakpoint
ALTER TABLE "parallax_archive" ADD CONSTRAINT "parallax_archive_vehicle_seq_vehicles_seq_fk" FOREIGN KEY ("vehicle_seq") REFERENCES "public"."vehicles"("seq") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parallax_archive" ADD CONSTRAINT "parallax_archive_topic_id_parallax_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."parallax_topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parallax_chunks" ADD CONSTRAINT "parallax_chunks_vehicle_seq_vehicles_seq_fk" FOREIGN KEY ("vehicle_seq") REFERENCES "public"."vehicles"("seq") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parallax_chunks" ADD CONSTRAINT "parallax_chunks_topic_id_parallax_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."parallax_topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_changes" ADD CONSTRAINT "state_changes_vehicle_seq_vehicles_seq_fk" FOREIGN KEY ("vehicle_seq") REFERENCES "public"."vehicles"("seq") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_changes" ADD CONSTRAINT "state_changes_field_id_state_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."state_fields"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_heartbeats" ADD CONSTRAINT "state_heartbeats_vehicle_seq_vehicles_seq_fk" FOREIGN KEY ("vehicle_seq") REFERENCES "public"."vehicles"("seq") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "parallax_archive_vehicle_topic_at_idx" ON "parallax_archive" USING btree ("vehicle_seq","topic_id","at");--> statement-breakpoint
CREATE INDEX "location_points_drive_ts_idx" ON "location_points" USING btree ("drive_id","ts");
--> statement-breakpoint
ALTER TABLE "parallax_chunks" ALTER COLUMN "data" SET STORAGE EXTERNAL;