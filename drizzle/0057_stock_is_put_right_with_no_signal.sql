-- STOCK IS PUT RIGHT WITH NO SIGNAL (13 November 2026): a receipt, an
-- adjustment and a count can be made on a phone and sent when it has a
-- signal. Each keeps the uuid it was made with, so one sent twice -- a retry
-- after a timeout -- is one; a material received on a phone keeps the uuid a
-- line drawing from it named before it arrived.

ALTER TABLE "material" ADD COLUMN "client_uuid" uuid;--> statement-breakpoint
ALTER TABLE "stock_adjustment" ADD COLUMN "client_uuid" uuid;--> statement-breakpoint
ALTER TABLE "stock_count" ADD COLUMN "client_uuid" uuid;--> statement-breakpoint
ALTER TABLE "stock_receipt" ADD COLUMN "client_uuid" uuid;--> statement-breakpoint
ALTER TABLE "material" ADD CONSTRAINT "material_client_uuid_key" UNIQUE("client_uuid");--> statement-breakpoint
ALTER TABLE "stock_adjustment" ADD CONSTRAINT "stock_adjustment_created_by_client_uuid_key" UNIQUE("created_by","client_uuid");--> statement-breakpoint
ALTER TABLE "stock_count" ADD CONSTRAINT "stock_count_created_by_client_uuid_key" UNIQUE("created_by","client_uuid");--> statement-breakpoint
ALTER TABLE "stock_receipt" ADD CONSTRAINT "stock_receipt_client_uuid_key" UNIQUE("client_uuid");