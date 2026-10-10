-- A TRIP IS RECORDED IN THE APP. A trip says why it was driven, what the
-- odometer read if anybody read it, and where it started and ended when that
-- was not the base; each stop says who it was for, and each leg the stop it
-- drove to. A trip carries the id it was made with, so a save sent twice is one
-- trip. A leg given to someone by hand, rather than by the rule, says so.
CREATE TABLE "trip_stop_client" (
	"trip_stop_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"site_id" uuid,
	"asked_there" boolean DEFAULT false NOT NULL,
	CONSTRAINT "trip_stop_client_pkey" PRIMARY KEY("trip_stop_id","entity_id")
);
--> statement-breakpoint
ALTER TABLE "trip_leg" DROP CONSTRAINT "trip_leg_rule_check";
--> statement-breakpoint
ALTER TABLE "trip" ADD COLUMN "client_uuid" uuid;
--> statement-breakpoint
ALTER TABLE "trip" ADD COLUMN "note" text;
--> statement-breakpoint
ALTER TABLE "trip" ADD COLUMN "odometer_start" numeric(9, 1);
--> statement-breakpoint
ALTER TABLE "trip" ADD COLUMN "odometer_end" numeric(9, 1);
--> statement-breakpoint
ALTER TABLE "trip" ADD COLUMN "start_address" text;
--> statement-breakpoint
ALTER TABLE "trip" ADD COLUMN "end_address" text;
--> statement-breakpoint
ALTER TABLE "trip_leg" ADD COLUMN "to_stop_id" uuid;
--> statement-breakpoint
ALTER TABLE "trip" ADD CONSTRAINT "trip_client_uuid_key" UNIQUE("client_uuid");
--> statement-breakpoint
ALTER TABLE "trip_stop" ADD CONSTRAINT "trip_stop_trip_id_id_key" UNIQUE("trip_id","id");
--> statement-breakpoint
ALTER TABLE "trip_stop_client" ADD CONSTRAINT "trip_stop_client_trip_stop_id_fkey" FOREIGN KEY ("trip_stop_id") REFERENCES "public"."trip_stop"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trip_stop_client" ADD CONSTRAINT "trip_stop_client_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trip_stop_client" ADD CONSTRAINT "trip_stop_client_site_is_the_clients" FOREIGN KEY ("entity_id","site_id") REFERENCES "public"."site"("entity_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trip_leg" ADD CONSTRAINT "trip_leg_to_stop_is_the_trips" FOREIGN KEY ("trip_id","to_stop_id") REFERENCES "public"."trip_stop"("trip_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trip" ADD CONSTRAINT "trip_odometer_reads_forward" CHECK ((("trip"."odometer_start" IS NULL) = ("trip"."odometer_end" IS NULL)) AND (("trip"."odometer_start" IS NULL) OR (("trip"."odometer_start" >= 0) AND ("trip"."odometer_end" >= "trip"."odometer_start"))));
--> statement-breakpoint
ALTER TABLE "trip" ADD CONSTRAINT "trip_places_are_something" CHECK ((btrim(coalesce("trip"."start_address", 'x')) <> '') AND (btrim(coalesce("trip"."end_address", 'x')) <> ''));
--> statement-breakpoint
ALTER TABLE "trip_leg" ADD CONSTRAINT "trip_leg_rule_check" CHECK ("trip_leg"."rule" = ANY (ARRAY['house_to_a', 'a_to_b', 'b_to_house', 'round_trip', 'split', 'unassigned', 'chosen']));
--> statement-breakpoint
ALTER TABLE "trip_stop" ADD CONSTRAINT "trip_stop_is_one_place" CHECK (num_nonnulls("trip_stop"."site_id", "trip_stop"."address") <= 1);
--> statement-breakpoint
-- A stop at a site was for that site's client: every trip already recorded
-- names its stops by site, and was for them.
INSERT INTO "trip_stop_client" ("trip_stop_id", "entity_id", "site_id")
SELECT ts."id", s."entity_id", s."id"
  FROM "trip_stop" ts
  JOIN "site" s ON s."id" = ts."site_id";
