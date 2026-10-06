ALTER TABLE "material_lot" ADD COLUMN "ex_tax_cost" numeric(13, 3);--> statement-breakpoint
ALTER TABLE "material_lot" ADD COLUMN "tax_paid" numeric(13, 3);--> statement-breakpoint
ALTER TABLE "material_lot" ADD COLUMN "paid_by" uuid;--> statement-breakpoint
ALTER TABLE "material_lot" ADD COLUMN "receipt" "bytea";--> statement-breakpoint
ALTER TABLE "material_lot" ADD COLUMN "receipt_type" text;--> statement-breakpoint
ALTER TABLE "material_lot" ADD CONSTRAINT "material_lot_paid_by_fkey" FOREIGN KEY ("paid_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- Every lot so far was recorded as a cost per unit, and its totals are those
-- costs times what was received. Not a change anybody made to a lot, so it is
-- not recorded as one: the history trigger is off while the figures move.
ALTER TABLE "material_lot" DISABLE TRIGGER "h_material_lot";--> statement-breakpoint
UPDATE "material_lot" SET "ex_tax_cost" = round("ex_tax_cost_per_unit" * "qty_received", 3),
                          "tax_paid" = round("tax_paid_per_unit" * "qty_received", 3);--> statement-breakpoint
ALTER TABLE "material_lot" ENABLE TRIGGER "h_material_lot";
