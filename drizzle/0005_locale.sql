ALTER TABLE "user" ADD COLUMN "locale" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "hour_cycle" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "week_start" smallint;--> statement-breakpoint
ALTER TABLE "operator" ADD COLUMN "locale" text DEFAULT 'en-US' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_hour_cycle_check" CHECK ("user"."hour_cycle" = ANY (ARRAY['h12', 'h23']));--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_week_start_check" CHECK ("user"."week_start" between 1 and 7);