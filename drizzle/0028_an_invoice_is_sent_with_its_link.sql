-- AN INVOICE IS SENT WITH ITS LINK. A draft is sent by dating it, giving it its
-- due date, and a link the client opens without signing in (/invoice/<token>).
-- Paid stops being a status: it is the balance -- what is owed coming to
-- nothing -- so a refund after it is paid makes it owed again instead of
-- leaving a status that says otherwise.
ALTER TABLE "invoice" DROP CONSTRAINT "invoice_status_check";--> statement-breakpoint
-- An invoice marked paid is sent, owed what its balance says.
UPDATE "invoice" SET "status" = 'sent' WHERE "status" = 'paid';--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_status_check" CHECK ("invoice"."status" = ANY (ARRAY['draft', 'sent', 'void']));--> statement-breakpoint
-- One sent before there were links is given one, the one time a sent invoice
-- is written to past its status: the freeze is lifted for it alone.
ALTER TABLE "invoice" DISABLE TRIGGER freeze_invoice;--> statement-breakpoint
UPDATE "invoice"
   SET "public_token" = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
 WHERE "status" = 'sent' AND "public_token" IS NULL;--> statement-breakpoint
ALTER TABLE "invoice" ENABLE TRIGGER freeze_invoice;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "sent_invoices_have_a_link" CHECK (("invoice"."status" <> 'sent' OR "invoice"."public_token" IS NOT NULL) AND ("invoice"."status" <> 'draft' OR "invoice"."public_token" IS NULL));
