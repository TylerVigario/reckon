ALTER TABLE "material_lot" DROP CONSTRAINT "material_lot_ex_tax_cost_per_unit_check";--> statement-breakpoint
ALTER TABLE "material_lot" DROP CONSTRAINT "material_lot_tax_paid_per_unit_check";--> statement-breakpoint
ALTER TABLE "material_lot" ALTER COLUMN "ex_tax_cost" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "material_lot" ALTER COLUMN "tax_paid" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "material_lot" ALTER COLUMN "tax_paid" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "material_lot" DROP COLUMN "document_ref";--> statement-breakpoint
ALTER TABLE "material_lot" DROP COLUMN "ex_tax_cost_per_unit";--> statement-breakpoint
ALTER TABLE "material_lot" DROP COLUMN "tax_paid_per_unit";--> statement-breakpoint
ALTER TABLE "material_lot" ADD CONSTRAINT "material_lot_ex_tax_cost_check" CHECK ("material_lot"."ex_tax_cost" >= 0);--> statement-breakpoint
ALTER TABLE "material_lot" ADD CONSTRAINT "material_lot_tax_paid_check" CHECK ("material_lot"."tax_paid" >= 0);--> statement-breakpoint
ALTER TABLE "material_lot" ADD CONSTRAINT "material_lot_receipt_comes_with_its_type" CHECK (("material_lot"."receipt" IS NULL) = ("material_lot"."receipt_type" IS NULL));--> statement-breakpoint
ALTER TABLE "material_lot" ADD CONSTRAINT "material_lot_receipt_type_check" CHECK ("material_lot"."receipt_type" = ANY (ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']));--> statement-breakpoint
ALTER TABLE "material_lot" ADD CONSTRAINT "material_lot_receipt_size_check" CHECK (octet_length("material_lot"."receipt") <= 2097152);