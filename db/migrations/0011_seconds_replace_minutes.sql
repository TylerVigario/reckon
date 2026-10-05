ALTER TABLE "time_entry" DROP CONSTRAINT "time_entry_minutes_check";--> statement-breakpoint
ALTER TABLE "time_entry" ALTER COLUMN "seconds" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entry" DROP COLUMN "minutes";--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_seconds_check" CHECK ("time_entry"."seconds" > 0);--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_times_come_together" CHECK ((("time_entry"."started_at" IS NULL) = ("time_entry"."ended_at" IS NULL)) AND (("time_entry"."started_at" IS NULL) = ("time_entry"."zone" IS NULL)));--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_seconds_are_its_times" CHECK (("time_entry"."started_at" IS NULL) OR (("time_entry"."ended_at" > "time_entry"."started_at") AND ("time_entry"."seconds" = extract(epoch FROM "time_entry"."ended_at" - "time_entry"."started_at"))));