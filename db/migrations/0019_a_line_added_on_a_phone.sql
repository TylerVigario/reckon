-- A line added by hand is saved on the phone first and sent when there is a
-- signal, as a time entry is; the uuid the phone made for it keeps a retry
-- from adding it twice.
ALTER TABLE "invoice_line" ADD COLUMN "client_uuid" uuid;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_client_uuid_key" UNIQUE("client_uuid");