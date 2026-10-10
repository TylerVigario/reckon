-- A line drawn from stock names its material, and what it took off each lot is
-- stock_draw (0017), so the one lot it named goes.
ALTER TABLE "invoice_line" DROP CONSTRAINT "one_source_at_most";--> statement-breakpoint
ALTER TABLE "invoice_line" DROP CONSTRAINT "invoice_line_material_lot_id_fkey";
--> statement-breakpoint
DROP INDEX "invoice_line_material";--> statement-breakpoint
ALTER TABLE "invoice_line" DROP COLUMN "material_lot_id";--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "one_source_at_most" CHECK ((("invoice_line"."time_entry_id" IS NOT NULL)::integer + ("invoice_line"."trip_leg_id" IS NOT NULL)::integer + ("invoice_line"."agreement_period_id" IS NOT NULL)::integer + ("invoice_line"."material_id" IS NOT NULL)::integer) <= 1);