-- A draft can be started on a phone with no signal: the uuid the phone made
-- keeps a retry from starting it twice, and it takes its number when it
-- arrives. A line added on a phone to a draft that went out before the line
-- arrived starts a new draft for the client instead, and keeps which it was
-- meant for.
ALTER TABLE "invoice" ADD COLUMN "client_uuid" uuid;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "moved_from_invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_moved_from_invoice_id_fkey" FOREIGN KEY ("moved_from_invoice_id") REFERENCES "public"."invoice"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_client_uuid_key" UNIQUE("client_uuid");