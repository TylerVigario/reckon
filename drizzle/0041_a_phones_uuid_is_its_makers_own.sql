-- A PHONE'S UUID IS ITS MAKER'S OWN (#lib/queue). Every time entry, trip,
-- draft, line and payment a phone queues carries a uuid it made, so a retry is
-- answered with what already arrived. That uuid is now unique to whoever made
-- the row, not across everyone: a repeat from them still finds what they sent,
-- and one sent by anyone else neither returns their row nor is quietly taken
-- for it.
ALTER TABLE "time_entry" DROP CONSTRAINT "time_entry_client_uuid_key";--> statement-breakpoint
ALTER TABLE "trip" DROP CONSTRAINT "trip_client_uuid_key";--> statement-breakpoint
ALTER TABLE "invoice" DROP CONSTRAINT "invoice_client_uuid_key";--> statement-breakpoint
ALTER TABLE "invoice_line" DROP CONSTRAINT "invoice_line_client_uuid_key";--> statement-breakpoint
ALTER TABLE "person_payment" DROP CONSTRAINT "person_payment_client_uuid_key";--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_created_by_client_uuid_key" UNIQUE("created_by","client_uuid");--> statement-breakpoint
ALTER TABLE "trip" ADD CONSTRAINT "trip_created_by_client_uuid_key" UNIQUE("created_by","client_uuid");--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_created_by_client_uuid_key" UNIQUE("created_by","client_uuid");--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_created_by_client_uuid_key" UNIQUE("created_by","client_uuid");--> statement-breakpoint
ALTER TABLE "person_payment" ADD CONSTRAINT "person_payment_created_by_client_uuid_key" UNIQUE("created_by","client_uuid");