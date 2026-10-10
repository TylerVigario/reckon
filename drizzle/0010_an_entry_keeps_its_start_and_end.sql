ALTER TABLE "time_entry" ADD COLUMN "seconds" integer;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "zone" text;--> statement-breakpoint
-- Every entry so far was recorded as a length in minutes, and keeps it, in
-- seconds. Not a change anybody made to an entry, so it is not recorded as one:
-- the history trigger is off while the unit changes underneath.
ALTER TABLE "time_entry" DISABLE TRIGGER "h_time_entry";--> statement-breakpoint
UPDATE "time_entry" SET "seconds" = "minutes" * 60;--> statement-breakpoint
ALTER TABLE "time_entry" ENABLE TRIGGER "h_time_entry";
