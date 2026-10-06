ALTER TABLE "invoice_line" DROP CONSTRAINT "invoice_line_kind_check";--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "bought_from" text;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "paid_by" uuid;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "receipt" "bytea";--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "receipt_type" text;--> statement-breakpoint
ALTER TABLE "operator" ADD COLUMN "purchase_markup_pct" numeric(7, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_paid_by_fkey" FOREIGN KEY ("paid_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_receipt_comes_with_its_type" CHECK (("invoice_line"."receipt" IS NULL) = ("invoice_line"."receipt_type" IS NULL));--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_receipt_type_check" CHECK ("invoice_line"."receipt_type" = ANY (ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']));--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_receipt_size_check" CHECK (octet_length("invoice_line"."receipt") <= 2097152);--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "paid_by_is_for_what_was_bought" CHECK (("invoice_line"."paid_by" IS NULL) OR ("invoice_line"."kind" IN ('bought', 'paid_for')));--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_kind_check" CHECK ("invoice_line"."kind" = ANY (ARRAY['service', 'material', 'recurring', 'adjustment', 'bought', 'paid_for']));--> statement-breakpoint
ALTER TABLE "operator" ADD CONSTRAINT "operator_purchase_markup_pct_check" CHECK ("operator"."purchase_markup_pct" >= 0);