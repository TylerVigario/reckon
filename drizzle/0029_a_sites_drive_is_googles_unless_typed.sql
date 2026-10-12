-- A SITE'S DRIVE IS GOOGLE'S UNLESS TYPED. A site held one round trip and one
-- drive time, Google's or somebody's, and nothing said which: typing over
-- Google's figure lost it. Google's are now kept beside the typed ones, so the
-- figure being disagreed with stays in view, and the figures in force are
-- worked out from the two -- the typed one where there is one.
--
-- Every figure already here was typed, or came from before Google measured
-- anything, so each is kept as typed. Google's are measured when a site's place
-- is next chosen, or the business's.
ALTER TABLE "site" RENAME COLUMN "round_trip_miles" TO "typed_round_trip_miles";--> statement-breakpoint
ALTER TABLE "site" RENAME COLUMN "drive_minutes" TO "typed_drive_minutes";--> statement-breakpoint
ALTER TABLE "site" RENAME CONSTRAINT "site_round_trip_miles_check" TO "site_typed_round_trip_miles_check";--> statement-breakpoint
ALTER TABLE "site" RENAME CONSTRAINT "site_drive_minutes_check" TO "site_typed_drive_minutes_check";--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "google_round_trip_miles" numeric(8, 1);--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "google_drive_minutes" integer;--> statement-breakpoint
ALTER TABLE "site" ADD CONSTRAINT "site_google_round_trip_miles_check" CHECK ("site"."google_round_trip_miles" >= 0);--> statement-breakpoint
ALTER TABLE "site" ADD CONSTRAINT "site_google_drive_minutes_check" CHECK ("site"."google_drive_minutes" >= 0);--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "round_trip_miles" numeric(8, 1) GENERATED ALWAYS AS (COALESCE(typed_round_trip_miles, google_round_trip_miles)) STORED;--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "drive_minutes" integer GENERATED ALWAYS AS (COALESCE(typed_drive_minutes, google_drive_minutes)) STORED;
