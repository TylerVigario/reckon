-- A LOT IS ITS RECEIPT'S (13 November 2026): every lot names one (0052), and
-- its supplier, payer and file are the receipt's alone.

ALTER TABLE "material_lot" DROP CONSTRAINT "material_lot_receipt_comes_with_its_type";--> statement-breakpoint
ALTER TABLE "material_lot" DROP CONSTRAINT "material_lot_receipt_type_check";--> statement-breakpoint
ALTER TABLE "material_lot" DROP CONSTRAINT "material_lot_receipt_size_check";--> statement-breakpoint
ALTER TABLE "material_lot" DROP CONSTRAINT "material_lot_paid_by_fkey";
--> statement-breakpoint
ALTER TABLE "material_lot" ALTER COLUMN "receipt_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "material_lot" DROP COLUMN "supplier";--> statement-breakpoint
ALTER TABLE "material_lot" DROP COLUMN "paid_by";--> statement-breakpoint
ALTER TABLE "material_lot" DROP COLUMN "receipt";--> statement-breakpoint
ALTER TABLE "material_lot" DROP COLUMN "receipt_type";--> statement-breakpoint
-- The file history keeps whole when it changes, rather than describing it, is
-- the receipt's now, as a line's is.
CREATE OR REPLACE FUNCTION history_keeps(tbl text, col text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT (tbl, col) IN (('invoice_line', 'receipt'), ('stock_receipt', 'receipt'))
$$;
