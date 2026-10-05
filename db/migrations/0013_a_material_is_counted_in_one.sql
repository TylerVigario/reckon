ALTER TABLE "material" DROP CONSTRAINT "material_unit_check";--> statement-breakpoint
ALTER TABLE "invoice_line" DROP CONSTRAINT "invoice_line_unit_check";--> statement-breakpoint
ALTER TABLE "material" ALTER COLUMN "unit_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "material" DROP COLUMN "unit";--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_unit_is_something" CHECK (("invoice_line"."unit" IS NULL) OR (btrim("invoice_line"."unit") <> ''));